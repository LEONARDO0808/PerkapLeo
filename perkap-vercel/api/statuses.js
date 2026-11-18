import { init, getSql } from '../lib/db.js';
import { authUser } from '../lib/auth.js';

function slug(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || ('s' + Date.now());
}

export default async function handler(req, res) {
  try {
    await init();
    const sql = getSql();
    const u = await authUser(req);
    if (!u) return res.status(401).json({ error: 'Silakan login' });

    if (req.method === 'GET') {
      const rows = await sql`SELECT id, key, label, is_done, sort FROM statuses ORDER BY sort, id`;
      return res.status(200).json({
        statuses: rows.map((r) => ({
          id: String(r.id), key: r.key, label: r.label, isDone: r.is_done, sort: r.sort,
        })),
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const label = String(body.label || '').trim();
      const isDone = !!body.isDone;
      if (!label) return res.status(400).json({ error: 'Nama status wajib diisi' });
      if (label.length > 25) return res.status(400).json({ error: 'Nama status maksimal 25 karakter' });

      const exist = await sql`SELECT key FROM statuses WHERE lower(label) = lower(${label}) LIMIT 1`;
      if (exist[0]) return res.status(409).json({ error: 'Status dengan nama itu sudah ada' });

      let key = slug(label);
      const keyExist = await sql`SELECT key FROM statuses WHERE key = ${key} LIMIT 1`;
      if (keyExist[0]) key = key + '-' + Date.now().toString().slice(-4);

      const maxRow = await sql`SELECT COALESCE(MAX(sort),0)::int AS m FROM statuses`;
      const sort = ((maxRow[0] && maxRow[0].m) || 0) + 1;

      const ins = await sql`INSERT INTO statuses (key, label, is_done, sort)
        VALUES (${key}, ${label}, ${isDone}, ${sort}) RETURNING id, key, label, is_done, sort`;
      const r = ins[0];
      return res.status(201).json({
        status: { id: String(r.id), key: r.key, label: r.label, isDone: r.is_done, sort: r.sort },
      });
    }

    return res.status(405).json({ error: 'Metode tidak diizinkan' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
