-- Jalankan sekali di Supabase SQL Editor.
-- Satu baris per user; kolom data berisi JSON terenkripsi (AES-GCM) — Supabase tidak bisa membacanya.
create table public.vaults (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       text not null,
  version    integer not null default 1,   -- dinaikkan setiap simpan; dipakai untuk deteksi konflik
  updated_at timestamptz not null default now()
);
alter table public.vaults enable row level security;
create policy "vault_select_own" on public.vaults for select to authenticated using (user_id = auth.uid());
create policy "vault_insert_own" on public.vaults for insert to authenticated with check (user_id = auth.uid());
create policy "vault_update_own" on public.vaults for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.vaults to authenticated;

-- Bukti transfer (screenshot). Tiap baris dienkripsi dengan kunci acak sendiri; kuncinya
-- disimpan di dalam vault (terenkripsi), jadi Supabase tidak bisa melihat gambarnya.
-- Jalankan juga sekali di SQL Editor (untuk database yang sudah punya tabel vaults).
create table public.receipts (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       text not null check (length(data) < 4000000),
  created_at timestamptz not null default now()
);
alter table public.receipts enable row level security;
create policy "receipt_select_own" on public.receipts for select to authenticated using (user_id = auth.uid());
create policy "receipt_insert_own" on public.receipts for insert to authenticated with check (user_id = auth.uid());
create policy "receipt_delete_own" on public.receipts for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.receipts to authenticated;

-- Link detail payout untuk partner (dikirim lewat WhatsApp). Isinya dienkripsi dengan kunci acak;
-- kuncinya hanya ada di bagian #hash link (tidak pernah dikirim ke server).
-- Partner tidak login: baca lewat fungsi get_share(id) saja, jadi tabelnya tidak bisa didaftar/di-scan.
create table public.shares (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       text not null check (length(data) < 500000),
  created_at timestamptz not null default now()
);
alter table public.shares enable row level security;
create policy "share_insert_own" on public.shares for insert to authenticated with check (user_id = auth.uid());
create policy "share_delete_own" on public.shares for delete to authenticated using (user_id = auth.uid());
grant insert, delete on public.shares to authenticated;

create function public.get_share(share_id uuid) returns text
  language sql stable security definer set search_path = public
  as $$ select data from public.shares where id = share_id $$;
revoke all on function public.get_share(uuid) from public;
grant execute on function public.get_share(uuid) to anon, authenticated;

-- Bukti transfer di halaman partner. receipt_ids = gambar yang boleh dibuka lewat link itu
-- (kunci gambarnya ada di dalam data link yang terenkripsi). Aman dijalankan ulang.
alter table public.shares add column if not exists receipt_ids uuid[] not null default '{}';

create or replace function public.get_share_receipt(share_id uuid, receipt_id uuid) returns text
  language sql stable security definer set search_path = public
  as $$
    select r.data from public.receipts r
    join public.shares s on s.id = share_id and s.user_id = r.user_id
    where r.id = receipt_id and receipt_id = any(s.receipt_ids)
  $$;
revoke all on function public.get_share_receipt(uuid, uuid) from public;
grant execute on function public.get_share_receipt(uuid, uuid) to anon, authenticated;

-- Login partner (hanya password). Satu baris per pemilik: ringkasan khusus partner (share, subsidi,
-- status bayar, bukti) — tanpa margin kotor / invoice — dienkripsi dengan kunci dari password partner.
-- lookup = hash dari password partner (PBKDF2), dipakai untuk menemukan baris tanpa email.
create table public.partner_views (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  lookup      text not null unique check (lookup ~ '^[0-9a-f]{64}$'),
  data        text not null check (length(data) < 2000000),
  receipt_ids uuid[] not null default '{}',
  updated_at  timestamptz not null default now()
);
alter table public.partner_views enable row level security;
create policy "pview_select_own" on public.partner_views for select to authenticated using (user_id = auth.uid());
create policy "pview_insert_own" on public.partner_views for insert to authenticated with check (user_id = auth.uid());
create policy "pview_update_own" on public.partner_views for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "pview_delete_own" on public.partner_views for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.partner_views to authenticated;

create function public.get_partner_view(lookup_hex text)
  returns table (data text, updated_at timestamptz)
  language sql stable security definer set search_path = public
  as $$ select v.data, v.updated_at from public.partner_views v where v.lookup = lookup_hex $$;
revoke all on function public.get_partner_view(text) from public;
grant execute on function public.get_partner_view(text) to anon, authenticated;

create function public.get_partner_receipt(lookup_hex text, receipt_id uuid) returns text
  language sql stable security definer set search_path = public
  as $$
    select r.data from public.receipts r
    join public.partner_views v on v.lookup = lookup_hex and v.user_id = r.user_id
    where r.id = receipt_id and receipt_id = any(v.receipt_ids)
  $$;
revoke all on function public.get_partner_receipt(text, uuid) from public;
grant execute on function public.get_partner_receipt(text, uuid) to anon, authenticated;
