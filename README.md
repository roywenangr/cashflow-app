# Cashflow — Profit Sharing

Aplikasi web sederhana untuk mencatat margin kotor, menghitung share partner per termin, dan melacak pembayaran.

- **Termin 1**: tanggal 1 s/d tanggal batas (default 15) · **Termin 2**: setelahnya s/d akhir bulan
- Tandai termin sudah dibayar — nominal yang dibayar disimpan, jadi riwayat tidak berubah
- Grafik cashflow per bulan dengan pilihan rentang (6 bln, 12 bln, tahun ini, semua, atau custom)
- Tema gelap/terang, export & import backup JSON

Semua data tersimpan di `localStorage` browser — tidak ada server, tidak ada data yang dikirim ke mana pun.
Data tidak sinkron antar perangkat/browser; pakai **Export JSON** / **Import JSON** untuk memindahkan.

## Menjalankan lokal

```sh
python3 -m http.server 8000
```

lalu buka http://localhost:8000
