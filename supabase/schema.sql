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
