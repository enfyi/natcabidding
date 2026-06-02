-- Supabase Auth helpers for email login.
-- A BUE logs in with email, then claims the matching bidder profile by email.

create extension if not exists pgcrypto with schema extensions;

create unique index if not exists bidders_email_unique
  on bidders(lower(email))
  where active and email is not null;

create or replace function public.claim_current_bidder_profile()
returns table (
  profile_id uuid,
  first_name text,
  last_name text,
  initials text,
  initials_verified boolean,
  email text,
  phone text,
  role text,
  bid_role text,
  seniority_rank integer,
  area_id uuid,
  area_name text,
  bidder_count bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  login_email text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or login_email is null then
    raise exception 'Authentication is required.';
  end if;

  update bidders b
  set auth_user_id = auth.uid(),
      updated_at = now()
  where lower(b.email) = login_email
    and b.active
    and (b.auth_user_id is null or b.auth_user_id = auth.uid());

  return query
  select
    b.id,
    b.first_name,
    b.last_name,
    b.initials,
    b.initials_verified,
    b.email,
    b.phone,
    b.role,
    b.bid_role,
    b.seniority_rank,
    b.area_id,
    a.name as area_name,
    count(area_bidders.id) as bidder_count
  from bidders b
  join areas a on a.id = b.area_id
  left join bidders area_bidders on area_bidders.area_id = b.area_id and area_bidders.active
  where b.auth_user_id = auth.uid()
    and b.active
  group by b.id, a.name
  limit 1;
end;
$$;

grant execute on function public.claim_current_bidder_profile() to authenticated;

create or replace function public.update_current_bidder_profile(
  profile_initials text default null,
  profile_phone text default null
)
returns table (
  profile_id uuid,
  first_name text,
  last_name text,
  initials text,
  initials_verified boolean,
  email text,
  phone text,
  role text,
  bid_role text,
  seniority_rank integer,
  area_id uuid,
  area_name text,
  bidder_count bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  update bidders b
  set initials = nullif(upper(trim(profile_initials)), ''),
      initials_verified = false,
      initials_updated_at = now(),
      phone = nullif(trim(profile_phone), ''),
      updated_at = now()
  where b.auth_user_id = auth.uid()
    and b.active;

  return query
  select *
  from public.claim_current_bidder_profile();
end;
$$;

grant execute on function public.update_current_bidder_profile(text, text) to authenticated;

create table if not exists app_login_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  bidder_id uuid not null references bidders(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_login_accounts enable row level security;

create or replace function public.app_login_with_password(
  login_username text,
  login_password text
)
returns table (
  profile_id uuid,
  first_name text,
  last_name text,
  initials text,
  initials_verified boolean,
  email text,
  phone text,
  role text,
  bid_role text,
  seniority_rank integer,
  area_id uuid,
  area_name text,
  bidder_count bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    b.id,
    b.first_name,
    b.last_name,
    b.initials,
    b.initials_verified,
    b.email,
    b.phone,
    b.role,
    b.bid_role,
    b.seniority_rank,
    b.area_id,
    a.name as area_name,
    count(area_bidders.id) as bidder_count
  from app_login_accounts ala
  join bidders b on b.id = ala.bidder_id and b.active
  left join areas a on a.id = b.area_id
  left join bidders area_bidders on area_bidders.area_id = b.area_id and area_bidders.active
  where ala.active
    and lower(ala.username) = lower(trim(login_username))
    and ala.password_hash = extensions.crypt(login_password, ala.password_hash)
  group by b.id, a.name
  limit 1;
end;
$$;

grant execute on function public.app_login_with_password(text, text) to anon, authenticated;
