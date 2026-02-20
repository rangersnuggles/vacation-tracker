-- ============================================
-- ASSET TRACKING — Run in Supabase SQL Editor
-- ============================================

create type public.asset_condition as enum ('excellent', 'good', 'fair', 'poor');

create table public.assets (
  id uuid default gen_random_uuid() primary key,
  asset_type text not null,            -- 'laptop', 'monitor', 'phone', 'tablet', 'keyboard', 'mouse', 'headset', 'other'
  make text,                           -- 'Apple', 'Dell', 'LG', etc.
  model text,                          -- 'MacBook Pro 16"', 'UltraSharp U2723QE', etc.
  serial_number text,
  purchase_date date,
  purchase_cost numeric(10,2),
  warranty_expiration date,
  condition public.asset_condition default 'good',
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assets_assigned on public.assets(assigned_to);
create index idx_assets_type on public.assets(asset_type);
create index idx_assets_warranty on public.assets(warranty_expiration);

-- Auto-update updated_at
create or replace function update_assets_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger assets_updated_at
  before update on public.assets
  for each row execute function update_assets_timestamp();

-- RLS
alter table public.assets enable row level security;

-- Everyone can view assets (employees see their own via the app, but read access is open)
create policy "Anyone can view assets"
  on public.assets for select
  using (true);

-- Only admins can manage assets
create policy "Admins can insert assets"
  on public.assets for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update assets"
  on public.assets for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can delete assets"
  on public.assets for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
