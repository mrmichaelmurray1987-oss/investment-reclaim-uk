// Vercel Serverless Function — receives the Free Claim Assessment form.
// It does four things (the form still succeeds even if the extras fail):
//   1. Emails the lead to info@investmentreclaimuk.co.uk (via Resend)        [required]
//   2. Sends the lead an instant branded auto-reply (via Resend)             [best-effort]
//   3. Creates/updates a Brevo contact + adds to the "Website Leads" list    [best-effort]
//   4. Creates a Brevo CRM deal in the pipeline, linked to that contact      [best-effort]
//
// Vercel environment variables used:
//   RESEND_API_KEY          (required)  — from resend.com
//   BREVO_API_KEY           (required for CRM) — from Brevo SMTP & API
//   BREVO_LEADS_LIST_ID     (optional, default 3)
//   BREVO_PIPELINE_ID       (optional, default = the account's pipeline)
//   BREVO_STAGE_ID          (optional, default = first stage "New Enquiry")

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND) {
    return res.status(500).json({ error: 'Email service not configured (missing RESEND_API_KEY).' });
  }
  const BREVO = process.env.BREVO_API_KEY;
  const LEADS_LIST = parseInt(process.env.BREVO_LEADS_LIST_ID || '3', 10);
  const PIPELINE_ID = process.env.BREVO_PIPELINE_ID || '6a3e17df4f15f51f6b429f63';
  const STAGE_ID = process.env.BREVO_STAGE_ID || 'fde811d057714c71a37b12706b2bd359';

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

  const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const nameParts = (name === 'Not provided' ? '' : name).split(' ').filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  // UK phone -> international (+44) for Brevo's SMS field
  const digits = phone.replace(/\D/g, '');
  let intlPhone = '';
  if (digits.startsWith('44')) intlPhone = '+' + digits;
  else if (digits.startsWith('0')) intlPhone = '+44' + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith('7')) intlPhone = '+44' + digits;
  else if (digits) intlPhone = '+' + digits;

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
    </div>`;
  const internalText = [
    'New Free Claim Assessment (investmentreclaimuk.co.uk)', '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', 'What happened:', description
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

  // 3 + 4. Brevo contact + deal
  if (BREVO && hasEmail) {
    const brevo = (path, body, method = 'POST') => fetch('https://api.brevo.com/v3/' + path, {
      method,
      headers: { 'api-key': BREVO, 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body)
    });
    const contactTask = brevo('contacts', {
      email,
      attributes: {
        FIRSTNAME: firstName, LASTNAME: lastName,
        PHONE: phone !== 'Not provided' ? phone : undefined,
        SCHEME: scheme, AMOUNT_LOST: amount, YEAR_INVESTED: year,
        LEAD_SOURCE: 'Website /claim'
      },
      listIds: [LEADS_LIST],
      updateEnabled: true
    }).then(async (cr) => {
      // Create a CRM deal linked to the contact (best-effort)
      let contactId;
      try { contactId = (await cr.json()).id; } catch (e) {}
      if (!contactId) {
        // contact already existed (update path returns 204) — fetch its id
        try {
          const g = await fetch('https://api.brevo.com/v3/contacts/' + encodeURIComponent(email), { headers: { 'api-key': BREVO, 'accept': 'application/json' } });
          contactId = (await g.json()).id;
        } catch (e) {}
      }
      const dealBody = { name: `${name} — claim` };
      if (contactId) dealBody.linkedContactsIds = [contactId];
      return brevo('crm/deals', dealBody).catch(() => {});
    }).catch(() => {});
    tasks.push(contactTask);
  }

  try { await Promise.allSettled(tasks); } catch (e) {}

  return res.status(200).json({ ok: true });
};
