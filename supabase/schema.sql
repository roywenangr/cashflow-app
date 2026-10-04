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
