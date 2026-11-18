import { init, getSql } from '../../lib/db.js';
import { authUser } from '../../lib/auth.js';
import { mapItem } from '../items.js';

const STATUSES = ['dipakai', 'dipinjam', 'dikembalikan'];

export default async function handler(req, res) {
  try {
    await init();
    const sql = getSql();
    const u = await authUser(req);
    if (!u) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });

    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID tidak valid' });

    const rows = await sql`SELECT * FROM items WHERE id = ${id} LIMIT 1`;
    const item = rows[0];
    if (!item) return res.status(404).json({ error: 'Barang tidak ditemukan' });

    const ownerId = item.created_by_id != null ? String(item.created_by_id) : null;
    const isOwner = ownerId
      ? ownerId === u.id
      : (item.created_by_name || '').toLowerCase() === u.name.toLowerCase();
    if (!isOwner) {
      return res.status(403).json({
        error: 'Hanya bisa mengubah barang yang Anda input sendiri. Barang orang lain hanya bisa dilihat.',
      });
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      let nama = item.nama;
      let jumlah = item.jumlah;
      let status = item.status;
      let keterangan = item.keterangan;

      if (body.nama !== undefined) {
        nama = String(body.nama).trim();
        if (!nama) return res.status(400).json({ error: 'Nama barang tidak boleh kosong' });
      }
      if (body.jumlah !== undefined) {
        jumlah = parseInt(body.jumlah, 10);
        if (!Number.isFinite(jumlah) || jumlah < 0) return res.status(400).json({ error: 'Jumlah harus angka 0 atau lebih' });
      }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Status tidak valid' });
        status = body.status;
      }
      if (body.keterangan !== undefined) keterangan = String(body.keterangan).trim();

      const upd = await sql`UPDATE items SET nama=${nama}, jumlah=${jumlah}, status=${status}, keterangan=${keterangan}, updated_at=now()
        WHERE id=${id} RETURNING *`;
      return res.status(200).json({ item: mapItem(upd[0]) });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM items WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Metode tidak diizinkan' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
