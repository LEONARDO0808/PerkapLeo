-- Skema database Perkap (dibuat OTOMATIS oleh aplikasi, file ini hanya rujukan)
-- Cocok untuk Postgres / Vercel Postgres / Neon / Supabase.

CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_idx ON users (lower(name));

CREATE TABLE IF NOT EXISTS statuses (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL,
  label      TEXT NOT NULL,
  is_done    BOOLEAN NOT NULL DEFAULT false,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id              BIGSERIAL PRIMARY KEY,
  nama            TEXT NOT NULL,
  jumlah          INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'dipakai',  -- dipakai | dipinjam | dikembalikan
  keterangan      TEXT,
  created_by_id   BIGINT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
