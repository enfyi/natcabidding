-- Restore the missing read API without updating bidding records.
begin;
create or replace function public.read_bid_year_settings(requested_bid_year integer)
returns table (bid_year integer, enforce_bid_windows boolean, test_bid_round integer, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select y.bid_year, coalesce(s.enforce_bid_windows, true), s.test_bid_round, s.updated_at
  from public.bid_years y left join public.bid_year_settings s on s.bid_year_id = y.id
  where y.bid_year = requested_bid_year
$$;
revoke all on function public.read_bid_year_settings(integer) from public;
grant execute on function public.read_bid_year_settings(integer) to anon, authenticated;

create table if not exists public.bidding_site_settings (
  singleton boolean primary key default true check (singleton),
  active_bid_year_id uuid not null references public.bid_years(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.bidders(id)
);
alter table public.bidding_site_settings enable row level security;
revoke all on public.bidding_site_settings from public, anon, authenticated;
-- Initialize only an unambiguous existing year. Never manufacture or copy a year.
insert into public.bidding_site_settings(singleton, active_bid_year_id)
select true, id from public.bid_years where (select count(*) from public.bid_years) = 1
on conflict (singleton) do nothing;

create or replace function public.read_bid_year_catalog()
returns table (bid_year integer, status text, is_active boolean)
language sql stable security definer set search_path = '' as $$
  select y.bid_year, y.status, coalesce(y.id = s.active_bid_year_id, false)
  from public.bid_years y left join public.bidding_site_settings s on s.singleton
  order by y.bid_year desc
$$;
revoke all on function public.read_bid_year_catalog() from public;
grant execute on function public.read_bid_year_catalog() to anon, authenticated;

create or replace function public.set_active_bid_year(requested_bid_year integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system administrators can change the active bid year.' using errcode = '42501';
  end if;
  select id into target_id from public.bid_years where bid_year = requested_bid_year and status = 'open';
  if target_id is null then raise exception 'Choose an existing open bid year.'; end if;
  insert into public.bidding_site_settings(singleton, active_bid_year_id, updated_by)
  values (true, target_id, public.current_bidder_id())
  on conflict (singleton) do update set active_bid_year_id = excluded.active_bid_year_id,
    updated_by = excluded.updated_by, updated_at = now();
  return requested_bid_year;
end
$$;
revoke all on function public.set_active_bid_year(integer) from public, anon;
grant execute on function public.set_active_bid_year(integer) to authenticated;

-- Protect both RPC writes and direct writes, including stale browser sessions.
-- Row locking serializes submissions with an administrator changing the year.
create or replace function public.enforce_active_bid_year()
returns trigger language plpgsql security definer set search_path = '' as $$
declare active_id uuid; target_id uuid;
begin
  -- Database maintenance without an end-user JWT is unaffected.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select active_bid_year_id into active_id from public.bidding_site_settings where singleton for share;
  if tg_op = 'DELETE' then target_id := old.bid_year_id; else target_id := new.bid_year_id; end if;
  if target_id is distinct from active_id
     or (tg_op = 'UPDATE' and old.bid_year_id is distinct from active_id) then
    -- Administrators may maintain archives, but new bids must use the active year.
    if not public.is_current_admin() or (tg_op = 'INSERT' and tg_table_name in ('intake_submissions', 'leave_requests')) then
      raise exception 'This bid year is view-only. Select the active bid year to bid or make changes.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function public.enforce_active_bid_year() from public, anon, authenticated;
drop trigger if exists require_active_bid_year on public.intake_submissions;
create trigger require_active_bid_year before insert or update or delete on public.intake_submissions
for each row execute function public.enforce_active_bid_year();
drop trigger if exists require_active_bid_year on public.leave_requests;
create trigger require_active_bid_year before insert or update or delete on public.leave_requests
for each row execute function public.enforce_active_bid_year();
drop trigger if exists require_active_bid_year on public.rdo_lines;
create trigger require_active_bid_year before insert or update or delete on public.rdo_lines
for each row execute function public.enforce_active_bid_year();
notify pgrst, 'reload schema';
commit;
