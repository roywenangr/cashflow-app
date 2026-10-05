# Cashflow — Profit Sharing

Aplikasi web sederhana untuk mencatat margin kotor, menghitung share partner per termin, dan melacak pembayaran.

- **Termin 1**: tanggal 1 s/d tanggal batas (default 15) · **Termin 2**: setelahnya s/d akhir bulan
- Tandai termin sudah dibayar — nominal yang dibayar disimpan, jadi riwayat tidak berubah
- Grafik cashflow per bulan dengan pilihan rentang (6 bln, 12 bln, tahun ini, semua, atau custom)
- Tema gelap/terang, export & import backup JSON
- Login email + password, sinkron antar perangkat lewat Supabase — data dienkripsi di browser (AES-256-GCM, kunci dari PBKDF2) sebelum dikirim
- Tetap bisa dipakai offline; perubahan dikirim saat online, konflik antar perangkat ditanyakan

## Keamanan

- Dari password + email diturunkan dua nilai (PBKDF2-SHA256, 600.000 iterasi): satu untuk login Supabase, satu lagi kunci enkripsi data.
  Password asli tidak pernah dikirim; Supabase hanya menyimpan ciphertext.
- Password **tidak bisa dipulihkan** — tanpa password, data tidak bisa dibuka siapa pun. Rutin **Export JSON** sebagai cadangan (file export tidak terenkripsi).
- `config.js` berisi Supabase URL + anon key; keduanya memang publik dan aksesnya dibatasi Row Level Security.

## Setup Supabase (sekali)

1. Buat project di https://supabase.com
2. Jalankan [`supabase/schema.sql`](supabase/schema.sql) di SQL Editor
3. Isi Project URL dan anon key di `config.js`

## Menjalankan lokal

```sh
python3 -m http.server 8000
```

lalu buka http://localhost:8000
