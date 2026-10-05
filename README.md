# Cashflow — Profit Sharing

Aplikasi web sederhana untuk mencatat margin kotor, menghitung share partner per payout, dan melacak pembayaran.

- **Payout 1**: tanggal 1 s/d tanggal batas (default 15) · **Payout 2**: setelahnya s/d akhir bulan
- Tandai payout sudah dibayar — nominal yang dibayar disimpan, jadi riwayat tidak berubah
- Grafik cashflow per bulan dengan pilihan rentang (6 bln, 12 bln, tahun ini, semua, atau custom)
- Tema gelap/terang, export & import backup JSON
- Login email + password, sinkron antar perangkat lewat Supabase — data dienkripsi di browser (AES-256-GCM, kunci dari PBKDF2) sebelum dikirim
- Tetap bisa dipakai offline; perubahan dikirim saat online, konflik antar perangkat ditanyakan

## Keamanan

- Dari password + email diturunkan dua nilai (PBKDF2-SHA256, 600.000 iterasi): satu untuk login Supabase, satu lagi kunci enkripsi data.
  Password asli tidak pernah dikirim; Supabase hanya menyimpan ciphertext.
- Password **tidak bisa dipulihkan** — tanpa password, data tidak bisa dibuka siapa pun. Rutin **Export JSON** sebagai cadangan (file export tidak terenkripsi).
- `lib/config.ts` berisi Supabase URL + anon key; keduanya memang publik dan aksesnya dibatasi Row Level Security.
  Bisa ditimpa lewat env `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Setup Supabase (sekali)

1. Buat project di https://supabase.com
2. Jalankan [`supabase/schema.sql`](supabase/schema.sql) di SQL Editor
3. Isi Project URL dan anon key di `lib/config.ts` (atau env var di Vercel)

## Struktur

Next.js (App Router, TypeScript). Semua data diproses di browser; tidak ada server sendiri selain Supabase.

- `app/` — halaman: `/` (pemilik), `/partner` (login partner), `/share` (link detail payout dari WhatsApp)
- `components/` — tampilan React
- `lib/crypto.ts` — enkripsi (format harus tetap sama supaya data & link lama terbaca)
- `lib/supabase.ts` — akses REST Supabase
- `lib/model.ts` — model data & perhitungan (fungsi murni)
- `lib/store.ts` — state aplikasi pemilik, sinkron, login, semua aksi
- `legacy/` — versi HTML lama, hanya acuan selama migrasi

## Menjalankan lokal

```sh
npm install
npm run dev
```

lalu buka http://localhost:3000

## Deploy

Import repo ini di https://vercel.com/new (framework terdeteksi otomatis sebagai Next.js).
Tambahkan alamat Vercel-nya di Supabase → Authentication → URL Configuration (Site URL / Redirect URLs)
supaya link konfirmasi email kembali ke aplikasi.
