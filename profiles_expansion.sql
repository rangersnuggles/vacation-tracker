-- ============================================
-- EMPLOYEE PROFILES EXPANSION — Run in Supabase SQL Editor
-- ============================================

-- Add new columns to profiles
alter table public.profiles
  add column if not exists title text,
  add column if not exists phone text,
  add column if not exists personal_email text,
  add column if not exists address_street text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists address_zip text,
  add column if not exists start_date date,
  add column if not exists birthday date,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relation text;
