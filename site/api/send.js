// Vercel Serverless Function — receives the Free Claim Assessment form.
//
// CONSENT: the request is REJECTED with 422 unless `consent` is true. The form's
// `required` checkbox is browser-side only and proves nothing, so the gate lives
// here. Every accepted enquiry carries a consent record — the exact wording that
// was displayed (captured from the DOM by the form, not retyped here, so it
// cannot drift), the browser timestamp, the server timestamp, the IP and the
// user-agent. That record goes into the internal notification email. Do not
// remove it: it is what evidences consent to a panel solicitor or to the ICO.
//
// Beyond that it does two things (the form still succeeds even if the second fails):
//   1. Emails the lead to info@investmentreclaimuk.co.uk (via Resend)        [required]
//   2. Sends the lead an instant branded auto-reply (via Resend)             [best-effort]
//
// Brevo was removed on 2026-08-28 (account cancelled; the claims CRM takes over
// lead intake under Plan 3). The notification email is the record of each lead
// until then.
//
// Vercel environment variables used:
//   RESEND_API_KEY          (required)  — from resend.com

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND) {
    return res.status(500).json({ error: 'Email service not configured (missing RESEND_API_KEY).' });
  }

  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};

  const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 2000);
  const name        = clean(data.name)        || 'Not provided';
  const email       = clean(data.email)       || 'Not provided';
  const phone       = clean(data.phone)       || 'Not provided';
  const amount      = clean(data.amount)      || 'Not provided';
  const scheme      = clean(data.scheme)      || 'Not provided';
  const year        = clean(data.year)        || 'Not provided';
  const description = clean(data.description) || '—';

  if (name === 'Not provided' && email === 'Not provided' && phone === 'Not provided') {
    return res.status(400).json({ error: 'Empty submission.' });
  }

  // ---- Consent gate + consent record ----
  // The checkbox is marked `required` in the form, but that is browser-side only.
  // No consent, no enquiry: we must never pass a lead to a solicitor without a
  // recorded consent, and we must be able to evidence it later.
  const consentGiven = data.consent === true || data.consent === 'true' || data.consent === 'on' || data.consent === 1;
  if (!consentGiven) {
    return res.status(422).json({ error: 'Consent is required before an enquiry can be submitted.' });
  }

  // Wording is captured from the DOM by the form, so it is the text actually shown.
  const consentText = clean(data.consentText) || '(wording not captured — investigate)';
  const consentPage = clean(data.consentPage) || 'Not provided';
  const consentTickedAt = clean(data.consentTimestamp) || 'Not provided';
  // Server-side facts the browser cannot forge, for the audit trail.
  const receivedAt = new Date().toISOString();
  const consentIp = clean(
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] || ''
  ) || 'Not recorded';
  const consentUserAgent = clean(req.headers['user-agent']) || 'Not recorded';

  const consentRows = [
    ['Consent given', 'YES'],
    ['Ticked at (browser clock)', consentTickedAt],
    ['Received at (server, authoritative)', receivedAt],
    ['Submitted from page', consentPage],
    ['IP address', consentIp],
    ['Browser / device', consentUserAgent],
    ['Exact wording shown', consentText]
  ];

  const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const nameParts = (name === 'Not provided' ? '' : name).split(' ').filter(Boolean);
  const firstName = nameParts[0] || '';

  const rows = [
    ['Name', name], ['Email', email], ['Phone', phone],
    ['Approx. amount invested / lost', amount], ['Scheme / company', scheme],
    ['Approx. year of investment', year]
  ];

  // ---- 1. Internal notification to the team (required) ----
  const internalHtml = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1E2937;max-width:560px;">
      <h2 style="font-family:Georgia,serif;color:#0F172A;margin:0 0 4px;">New Free Claim Assessment</h2>
      <p style="color:#64748B;margin:0 0 18px;font-size:14px;">Submitted via investmentreclaimuk.co.uk</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:8px 12px;background:#0F172A;color:#fff;font-weight:600;width:42%;">${k}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e7edf4;color:#334155;">${v}</td>
        </tr>`).join('')}
      </table>
      <p style="margin:18px 0 6px;font-weight:600;color:#1E3A5F;">What happened</p>
      <p style="white-space:pre-wrap;line-height:1.6;color:#334155;font-size:14px;margin:0;">${description}</p>
      <p style="margin:24px 0 6px;font-weight:600;color:#1E3A5F;">Consent record</p>
      <p style="color:#64748B;margin:0 0 10px;font-size:12px;">Keep this. It is the evidence that consent was given, and what was shown when it was.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${consentRows.map(([k, v]) => `<tr>
          <td style="padding:7px 12px;background:#F1F5F9;color:#334155;font-weight:600;width:42%;vertical-align:top;">${k}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #e7edf4;color:#334155;word-break:break-word;">${v}</td>
        </tr>`).join('')}
      </table>
    </div>`;
  const internalText = [
    'New Free Claim Assessment (investmentreclaimuk.co.uk)', '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', 'What happened:', description,
    '', '--- Consent record (keep this) ---',
    ...consentRows.map(([k, v]) => `${k}: ${v}`)
  ].join('\n');

  const sendResend = (payload) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  try {
    const r = await sendResend({
      from: 'Investment Reclaim UK <enquiries@investmentreclaimuk.co.uk>',
      to: ['info@investmentreclaimuk.co.uk'],
      reply_to: hasEmail ? email : undefined,
      subject: `Free Claim Assessment — ${name}`,
      html: internalHtml, text: internalText
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: 'Email provider rejected the request.', detail });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send.', detail: String(err) });
  }

  // ---- 2,3,4: best-effort side effects (never block the form) ----
  const tasks = [];

  // 2. Auto-reply to the lead
  if (hasEmail) {
    const replyHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#334155;max-width:560px;line-height:1.6;">
        <div style="background:#0F172A;padding:18px 24px;border-bottom:2px solid #C9A227;">
          <span style="font-family:Georgia,serif;font-size:17px;font-weight:bold;letter-spacing:1.5px;color:#F8FAFC;">INVESTMENT RECLAIM <span style="color:#C9A227;">UK</span></span>
        </div>
        <div style="padding:26px 24px;">
          <p style="margin:0 0 14px;">Hi ${firstName || 'there'},</p>
          <p style="margin:0 0 14px;">Thank you — we've received your free claim check and a specialist from our panel will review it and be in touch <strong>within 24 hours</strong>.</p>
          <p style="margin:0 0 14px;">Everything you've shared is kept strictly confidential, and there's no obligation to proceed.</p>
          <p style="margin:18px 0 0;">Kind regards,<br>The team at Investment Reclaim UK</p>
        </div>
        <div style="background:#0F172A;padding:16px 24px;font-size:11px;color:#94a3b8;line-height:1.6;">
          Investment Reclaim UK is a trading style of Coresight Creative Limited (company number 16828110), registered in England &amp; Wales. Registered office: 128 City Road, London EC1V 2NX. We introduce clients to a panel of SRA-regulated solicitors; we are not a law firm.
        </div>
      </div>`;
    tasks.push(sendResend({
      from: 'Investment Reclaim UK <enquiries@investmentreclaimuk.co.uk>',
      to: [email],
      subject: 'We’ve received your free claim check',
      html: replyHtml,
      text: `Hi ${firstName || 'there'},\n\nThank you — we've received your free claim check and a specialist will be in touch within 24 hours. Everything is kept strictly confidential, with no obligation.\n\nKind regards,\nInvestment Reclaim UK`
    }).catch(() => {}));
  }

  try { await Promise.allSettled(tasks); } catch (e) {}

  return res.status(200).json({ ok: true });
};
