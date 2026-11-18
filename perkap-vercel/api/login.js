import { init, getSql } from '../lib/db.js';
import { signToken } from '../lib/auth.js';

// Login berdasarkan NAMA. Nama baru otomatis dibuat, nama yang sudah ada langsung dipakai.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });
  try {
    await init();
    const sql = getSql();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const nama = String(body.nama || body.username || '').trim().replace(/\s+/g, ' ');
    if (nama.length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter' });
    if (nama.length > 30) return res.status(400).json({ error: 'Nama maksimal 30 karakter' });

    let rows = await sql`SELECT id, name FROM users WHERE lower(name) = lower(${nama}) LIMIT 1`;
    let user = rows[0];
    let created = false;

    if (!user) {
      try {
        const ins = await sql`INSERT INTO users (name) VALUES (${nama}) RETURNING id, name`;
        user = ins[0];
        created = true;
      } catch (e) {
        // kemungkinan dua orang daftar bersamaan -> ambil yang sudah ada
        const again = await sql`SELECT id, name FROM users WHERE lower(name) = lower(${nama}) LIMIT 1`;
        user = again[0];
      }
    }
    if (!user) return res.status(500).json({ error: 'Gagal membuat pengguna' });

    const token = await signToken(user);
    return res.status(200).json({
      token,
      user: { id: String(user.id), username: user.name },
      created,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
