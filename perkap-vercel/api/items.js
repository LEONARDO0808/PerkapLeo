import { init, getSql } from '../lib/db.js';
import { authUser } from '../lib/auth.js';

const STATUSES = ['dipakai', 'dipinjam', 'dikembalikan'];

export function mapItem(r) {
  return {
    id: String(r.id),
    nama: r.nama,
    jumlah: r.jumlah,
    satuan: r.satuan || '',
    status: r.status,
    keterangan: r.keterangan || '',
    createdById: r.created_by_id != null ? String(r.created_by_id) : null,
    createdBy: r.created_by_name || '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  };
}

export default async function handler(req, res) {
  try {
    await init();
    const sql = getSql();
    const u = await authUser(req);
    if (!u) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });

    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM items ORDER BY created_at DESC`;
      return res.status(200).json({ items: rows.map(mapItem) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const nama = String(body.nama || '').trim();
      const jumlah = parseInt(body.jumlah, 10);
      const satuan = String(body.satuan || '').trim().slice(0, 20);
      const status = String(body.status || 'dipakai').trim().slice(0, 30) || 'dipakai';
      const keterangan = String(body.keterangan || '').trim();
      if (!nama) return res.status(400).json({ error: 'Nama barang wajib diisi' });
      if (!Number.isFinite(jumlah) || jumlah < 0) return res.status(400).json({ error: 'Jumlah harus angka 0 atau lebih' });

      const rows = await sql`INSERT INTO items (nama, jumlah, satuan, status, keterangan, created_by_id, created_by_name)
        VALUES (${nama}, ${jumlah}, ${satuan}, ${status}, ${keterangan}, ${Number(u.id)}, ${u.name}) RETURNING *`;
      return res.status(201).json({ item: mapItem(rows[0]) });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM items`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Metode tidak diizinkan' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
