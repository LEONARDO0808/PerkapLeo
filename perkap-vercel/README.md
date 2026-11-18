# Perkap — Versi Vercel (online, bisa dibuka dari HP mana saja)

Ini versi **siap deploy ke Vercel** dengan database **Vercel Postgres (gratis)**.
Setelah online, Anda dapat **link publik https** yang bisa dibuka dari HP mana pun
(pakai data seluler sekalipun), tanpa perlu hotspot atau laptop menyala.

Fitur tetap sama: tambah/ubah/hapus, jumlah barang, status (Dipakai/Dipinjam/
Dikembalikan + tercoret), login cukup NAMA, semua lihat data sama, tapi hanya
pembuat yang bisa mengubah/menghapus barangnya sendiri.

---

## Yang perlu disiapkan
- Akun **Vercel** (gratis) — daftar di https://vercel.com (bisa pakai Google/GitHub).
- Akun **GitHub** (gratis) — untuk meng-upload kode (cara termudah).
- Koneksi internet saat deploy.

---

## Langkah deploy (cara termudah: lewat GitHub)

### 1) Upload kode ke GitHub
1. Buat repository baru di https://github.com/new (nama bebas, mis. `perkap`), **Private** boleh.
2. Di halaman repo → tombol **"Add file" → "Upload files"**.
3. **Tarik (drag) SEMUA isi folder `perkap-vercel`** ke situ:
   - `package.json`
   - folder `api` (berisi login.js, logout.js, me.js, items.js, dan folder items/[id].js)
   - folder `lib`
   - folder `public`
   - (README ini & `.gitignore` opsional)
4. Klik **Commit changes**.

### 2) Import ke Vercel
1. Buka https://vercel.com/new → pilih **"Import Git Repository"** → pilih repo `perkap`.
2. **Framework Preset: Other** (biarkan default).
3. Klik **Deploy**. Tunggu sampai selesai (muncul "Congratulations").
   - Saat ini aplikasi sudah ter-online, tapi **belum ada database** → akan muncul error
     "Database belum diset". Lanjut langkah 3.

### 3) Tambahkan Database (Vercel Postgres, gratis)
1. Buka project di Vercel → tab **Storage** → **Create Database** → pilih **Postgres** (Neon).
2. Buat (region terdekat, mis. Singapore) → lalu **Connect** ke project ini.
3. Vercel otomatis menambahkan environment variable (`POSTGRES_URL` / `DATABASE_URL`).
4. Pergi ke tab **Deployments** → klik **Redeploy** (agar env terbaca).
   - Setelah redeploy, buka domain `https://xxx.vercel.app` → tabel dibuat otomatis. Selesai!

> Tidak perlu menjalankan SQL manual — tabel `users` & `items` dibuat otomatis saat pertama dipakai.
> (Rujukan skema ada di `schema.sql`.)

### 4) Selesai — bagikan link
- Bagikan URL `https://xxx.vercel.app` ke siapa pun. Buka dari HP → login tulis NAMA.
- Di HP (Chrome) bisa **"Tambahkan ke layar utama"** → jadi seperti aplikasi (PWA).

---

## Alternatif: pakai Neon.tech (kalau tidak pakai Storage Vercel)
1. Buat database gratis di https://neon.tech → copy **Connection string**.
2. Di Vercel → Project → **Settings → Environment Variables** → tambah:
   - Name: `DATABASE_URL`
   - Value: (connection string Neon, yang ada `?sslmode=require`)
3. **Redeploy**. Selesai.

## Alternatif deploy via CLI (kalau biasa terminal)
```
npm i -g vercel
cd perkap-vercel
vercel          # login, ikuti instruksi
vercel --prod   # deploy produksi
```
Lalu tambahkan database seperti langkah 3.

---

## Opsional (disarankan): kunci keamanan token
Secara default ada secret bawaan. Untuk lebih aman, di Vercel → Settings → Environment
Variables tambahkan `JWT_SECRET` = teks acak panjang, lalu Redeploy.

## Catatan keamanan
Login hanya dengan nama (tanpa sandi) sesuai permintaan → **siapa pun yang punya link
bisa masuk**. Jangan sebar link ke publik umum; cukup ke panitia/acara. Untuk membatasi,
bisa ditambahkan pengecekan kata sandi nanti.

## Reset data
Hapus isi tabel lewat dashboard database (Neon/Vercel) atau jalankan:
```sql
TRUNCATE items RESTART IDENTITY;
```
