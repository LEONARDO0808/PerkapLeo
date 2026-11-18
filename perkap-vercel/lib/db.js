import { neon } from '@neondatabase/serverless';

let _sql = null;

export function getSql() {
  if (_sql) return _sql;
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Database belum diset. Tambahkan environment variable DATABASE_URL / POSTGRES_URL di Vercel (Storage -> Postgres).'
    );
  }
  _sql = neon(url);
  return _sql;
}

let ready = null;

// Membuat tabel otomatis saat pertama kali dipakai (tanpa perlu jalankan SQL manual).
export function init() {
  if (!ready) {
    ready = (async () => {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_idx ON users (lower(name))`;
      await sql`CREATE TABLE IF NOT EXISTS items (
        id BIGSERIAL PRIMARY KEY,
        nama TEXT NOT NULL,
        jumlah INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'dipakai',
        keterangan TEXT,
        created_by_id BIGINT,
        created_by_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
