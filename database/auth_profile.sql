-- Supabase Auth helpers for email login.
-- A BUE logs in with email, then claims the matching bidder profile by email.

create extension if not exists pgcrypto with schema extensions;

create unique index if not exists bidders_email_unique
  on bidders(lower(email))
  where active and email is not null;

create or replace function public.can_request_login_link(login_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from bidders b
    where b.active
      and b.email is not null
      and lower(b.email) = lower(trim(login_email))
  )
$$;

grant execute on function public.can_request_login_link(text) to anon, authenticated;

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
  set auth_user_id = null,
      updated_at = now()
  where b.auth_user_id = auth.uid()
    and b.active
    and lower(b.email) <> login_email;

  update bidders b
  set auth_user_id = auth.uid(),
      updated_at = now()
  where lower(b.email) = login_email
    and b.active
    and (b.auth_user_id is null or b.auth_user_id = auth.uid());

  return query
  with ranked_bidders as (
    select
      area_bidders.id,
      row_number() over (
        partition by area_bidders.area_id
        order by area_bidders.seniority_rank nulls last, area_bidders.last_name, area_bidders.first_name, area_bidders.id
      )::integer as area_seniority_rank,
      count(*) over (partition by area_bidders.area_id) as area_bidder_count
    from bidders area_bidders
    where area_bidders.active
  )
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
    rb.area_seniority_rank,
    b.area_id,
    a.name as area_name,
    rb.area_bidder_count as bidder_count
  from bidders b
  join areas a on a.id = b.area_id
  join ranked_bidders rb on rb.id = b.id
  where b.auth_user_id = auth.uid()
    and lower(b.email) = login_email
    and b.active
  limit 1;
end;
$$;

grant execute on function public.claim_current_bidder_profile() to authenticated;

create or replace function public.update_current_bidder_profile(
  profile_initials text default null,
  profile_phone text default null,
  profile_email text default null
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
      email = coalesce(nullif(lower(trim(profile_email)), ''), b.email),
      updated_at = now()
  where b.auth_user_id = auth.uid()
    and b.active;

  return query
  select *
  from public.claim_current_bidder_profile();
end;
$$;

grant execute on function public.update_current_bidder_profile(text, text, text) to authenticated;

-- Retire the legacy username/password admin login. All users now enter through
-- Supabase Auth and receive app access from their bidder role.
drop function if exists public.app_login_with_password(text, text);
drop table if exists public.app_login_accounts;
