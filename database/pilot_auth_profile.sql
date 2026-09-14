-- Minimal login bridge for the isolated pilot database.
-- Supabase Auth may contain unrostered users, but this function only links a
-- session to an active bidder whose roster email exactly matches the JWT email.

create unique index if not exists bidders_email_unique
  on public.bidders(lower(email))
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
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  login_email text := lower(auth.jwt() ->> 'email');
begin
  if caller_id is null or login_email is null then
    raise exception 'Authentication is required.';
  end if;

  update public.bidders b
  set auth_user_id = caller_id,
      updated_at = now()
  where lower(b.email) = login_email
    and b.active
    and (b.auth_user_id is null or b.auth_user_id = caller_id);

  return query
  with ranked_bidders as (
    select
      area_bidders.id,
      row_number() over (
        partition by area_bidders.area_id
        order by area_bidders.seniority_rank nulls last,
          area_bidders.last_name,
          area_bidders.first_name,
          area_bidders.id
      )::integer as area_seniority_rank,
      count(*) over (partition by area_bidders.area_id) as area_bidder_count
    from public.bidders area_bidders
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
    a.name,
    rb.area_bidder_count
  from public.bidders b
  join public.areas a on a.id = b.area_id
  join ranked_bidders rb on rb.id = b.id
  where b.auth_user_id = caller_id
    and lower(b.email) = login_email
    and b.active
  limit 1;
end;
$$;

revoke all on function public.claim_current_bidder_profile() from public, anon, authenticated;
grant execute on function public.claim_current_bidder_profile() to authenticated;
