// Dismissal boards API — only answers requests from the Cornerstone campus network.
// GET /api/dismissal            -> list of teacher boards
// GET /api/dismissal?slug=name  -> one teacher's board
const SB_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co';
const SB_KEY = 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0';

// Combined boards: one link that shows several homerooms together.
// key = the link (app.csjax.org/dismissal/<key>), slugs = the teachers' individual boards.
const COMBINED = {
  'williams-newkirk': { teacher_name: 'Williams & Newkirk', slugs: ['jarrodd-williams', 'alexandria-newkirk'] }
};

function merge(slug, def, boards) {
  boards = boards.filter(Boolean);
  if (!boards.length) return null;
  const date = boards.map(b => b.board_date).sort().pop();          // newest pull
  const today = boards.filter(b => b.board_date === date);
  const groups = [];
  for (const b of today) {
    const who = b.teacher_name.split(' ').slice(-1)[0];               // last name tag
    for (const g of b.groups || []) {
      let m = groups.find(x => x.method === g.method);
      if (!m) groups.push(m = { key: g.key, method: g.method, students: [] });
      for (const st of g.students || []) m.students.push({ ...st, teacher: who });
    }
  }
  groups.forEach(g => g.students.sort((a, b) => a.name.localeCompare(b.name)));
  return {
    slug, teacher_name: def.teacher_name, combined: true, board_date: date,
    updated_at: today.map(b => b.updated_at).sort().pop(),
    groups, absent: today.flatMap(b => b.absent || []).sort()
  };
}

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

  const rpc = async p_slug => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/read_dismissal`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: readKey, p_slug })
    });
    if (!r.ok) throw new Error('upstream');
    return r.json();
  };
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };

  try {
    if (!slug) {
      const list = await rpc(null);
      for (const [key, def] of Object.entries(COMBINED)) {
        const parts = list.filter(t => def.slugs.includes(t.slug));
        if (!parts.length) continue;
        list.push({ slug: key, teacher_name: def.teacher_name, combined: true,
          board_date: parts.map(t => t.board_date).sort().pop(), updated_at: parts.map(t => t.updated_at).sort().pop() });
      }
      list.sort((a, b) => a.teacher_name.localeCompare(b.teacher_name));
      return send(200, list);
    }
    if (COMBINED[slug]) {
      const b = merge(slug, COMBINED[slug], await Promise.all(COMBINED[slug].slugs.map(rpc)));
      return b ? send(200, b) : send(404, { error: 'not_found' });
    }
    const b = await rpc(slug);
    return b ? send(200, b) : send(404, { error: 'not_found' });
  } catch (_) {
    return send(502, { error: 'upstream' });
  }
};
