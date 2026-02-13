-- ============================================
-- COMPANY HOLIDAYS — Run in Supabase SQL Editor
-- ============================================

create table public.company_holidays (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  date date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_holidays_date on public.company_holidays(date);

-- RLS
alter table public.company_holidays enable row level security;

-- Everyone can read holidays
create policy "Anyone can view holidays"
  on public.company_holidays for select
  using (true);

-- Only admins can manage holidays
create policy "Admins can insert holidays"
  on public.company_holidays for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can delete holidays"
  on public.company_holidays for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
