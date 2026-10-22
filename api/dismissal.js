// Dismissal boards API — only answers requests from the Cornerstone campus network.
// GET /api/dismissal            -> list of teacher boards
// GET /api/dismissal?slug=name  -> one teacher's board
const SB_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co';
const SB_KEY = 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0';

function clientIp(req) {
  // Vercel sets x-real-ip / x-forwarded-for from the real connection and overwrites client-sent values.
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const fwd = req.headers['x-forwarded-for'];
  return fwd ? String(fwd).split(',')[0].trim() : '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const allowed = (process.env.DISMISSAL_ALLOWED_IPS || '107.1.157.26')
    .split(',').map(s => s.trim()).filter(Boolean);
  const ip = clientIp(req);
  if (!allowed.includes(ip)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'campus_only', ip }));
  }

  const readKey = process.env.DISMISSAL_READ_KEY;
  if (!readKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'not_configured' }));
  }

  const url = new URL(req.url, 'http://x');
  const slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '') || null;

  const r = await fetch(`${SB_URL}/rest/v1/rpc/read_dismissal`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: readKey, p_slug: slug })
  });
  const body = await r.text();
  res.statusCode = r.ok ? (body === 'null' ? 404 : 200) : 502;
  res.setHeader('Content-Type', 'application/json');
  res.end(r.ok ? (body === 'null' ? JSON.stringify({ error: 'not_found' }) : body) : JSON.stringify({ error: 'upstream' }));
};
