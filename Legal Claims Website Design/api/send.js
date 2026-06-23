// Vercel Serverless Function — receives the Free Claim Assessment form
// and emails it to info@investmentreclaimuk.co.uk via Resend.
//
// SETUP (one-time, in your Vercel project):
//   1. Add an Environment Variable:  RESEND_API_KEY = <your key from resend.com/api-keys>
//   2. Verify your domain in Resend (resend.com/domains) so you can send
//      "from" an investmentreclaimuk.co.uk address. Until then, use the
//      test sender onboarding@resend.dev (works immediately, for testing only).
//
// The form POSTs JSON to /api/send. No data is stored — it is emailed and discarded.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Email service not configured (missing RESEND_API_KEY).' });
  }

  // Body may arrive parsed (Vercel) or as a raw string.
  let data = req.body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { data = {}; }
  }
  data = data || {};

  const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 2000);
  const name        = clean(data.name)        || 'Not provided';
  const email       = clean(data.email)       || 'Not provided';
  const phone       = clean(data.phone)       || 'Not provided';
  const amount      = clean(data.amount)      || 'Not provided';
  const scheme      = clean(data.scheme)      || 'Not provided';
  const year        = clean(data.year)        || 'Not provided';
  const reference   = clean(data.reference)   || '—';
  const description = clean(data.description) || '—';

  // Basic guard
  if (name === 'Not provided' && email === 'Not provided' && phone === 'Not provided') {
    return res.status(400).json({ error: 'Empty submission.' });
  }

  const rows = [
    ['Name', name], ['Email', email], ['Phone', phone],
    ['Approx. amount invested / lost', amount], ['Scheme / company', scheme],
    ['Approx. year of investment', year], ['Memorable word / reference', reference]
  ];

  const html = `
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

  const text = [
    'New Free Claim Assessment (investmentreclaimuk.co.uk)', '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', 'What happened:', description
  ].join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Change "from" to a verified address on your domain, e.g.
        // 'Investment Reclaim UK <enquiries@investmentreclaimuk.co.uk>'.
        // For initial testing you can use 'onboarding@resend.dev'.
        from: 'Investment Reclaim UK <enquiries@investmentreclaimuk.co.uk>',
        to: ['info@investmentreclaimuk.co.uk'],
        reply_to: email !== 'Not provided' ? email : undefined,
        subject: `Free Claim Assessment — ${name}`,
        html,
        text
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: 'Email provider rejected the request.', detail });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send.', detail: String(err) });
  }
}
