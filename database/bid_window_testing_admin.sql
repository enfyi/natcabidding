-- Shared bid-window testing mode for a bid year.
-- Admins can relax BUE self-service bid-window enforcement while testing.

create table if not exists public.bid_year_settings (
  bid_year_id uuid primary key references public.bid_years(id) on delete cascade,
  enforce_bid_windows boolean not null default true,
  test_bid_round integer check (test_bid_round between 1 and 4),
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bid_year_settings
  add column if not exists test_bid_round integer;

do $$
begin
  alter table public.bid_year_settings
    add constraint bid_year_settings_test_bid_round_check
    check (test_bid_round between 1 and 4);
exception
  when duplicate_object then null;
end
$$;

alter table public.bid_year_settings enable row level security;

drop policy if exists "public can read bid year settings" on public.bid_year_settings;
create policy "public can read bid year settings"
on public.bid_year_settings for select
to anon
using (true);

drop policy if exists "users can read bid year settings" on public.bid_year_settings;
create policy "users can read bid year settings"
on public.bid_year_settings for select
to authenticated
using (true);

drop function if exists public.set_bid_window_enforcement(integer, boolean);
drop function if exists public.read_bid_year_settings(integer);

create or replace function public.read_bid_year_settings(requested_bid_year integer)
returns table (
  bid_year integer,
  enforce_bid_windows boolean,
  test_bid_round integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    byear.bid_year,
    coalesce(settings.enforce_bid_windows, true) as enforce_bid_windows,
    settings.test_bid_round,
    settings.updated_at
  from public.bid_years byear
  left join public.bid_year_settings settings on settings.bid_year_id = byear.id
  where byear.bid_year = requested_bid_year
$$;

revoke all on function public.read_bid_year_settings(integer) from public, anon, authenticated;
grant execute on function public.read_bid_year_settings(integer) to anon, authenticated;

create or replace function public.set_bid_window_testing_settings(
  requested_bid_year integer,
  should_enforce boolean,
  test_round integer default null
)
returns table (
  bid_year integer,
  enforce_bid_windows boolean,
  test_bid_round integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target_bid_year_id uuid;
begin
  if not public.is_current_admin() then
    raise exception 'Only system admins can change bid-window testing mode.';
  end if;

  select byear.id
  into target_bid_year_id
  from public.bid_years byear
  where byear.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % was not found.', requested_bid_year;
  end if;

  if test_round is not null and test_round not between 1 and 4 then
    raise exception 'Test round must be 1, 2, 3, or 4.';
  end if;

  insert into public.bid_year_settings (
    bid_year_id,
    enforce_bid_windows,
    test_bid_round,
    updated_by,
    updated_at
  ) values (
    target_bid_year_id,
    coalesce(should_enforce, true),
    test_round,
    actor_id,
    now()
  )
  on conflict (bid_year_id) do update
  set enforce_bid_windows = excluded.enforce_bid_windows,
      test_bid_round = excluded.test_bid_round,
      updated_by = excluded.updated_by,
      updated_at = now();

  return query
  select *
  from public.read_bid_year_settings(requested_bid_year);
end;
$$;

revoke all on function public.set_bid_window_testing_settings(integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.set_bid_window_testing_settings(integer, boolean, integer) to authenticated;

drop function if exists public.set_bid_window_enforcement(integer, boolean);

create or replace function public.set_bid_window_enforcement(
  requested_bid_year integer,
  should_enforce boolean
)
returns table (
  bid_year integer,
  enforce_bid_windows boolean,
  test_bid_round integer,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.set_bid_window_testing_settings(requested_bid_year, should_enforce, null)
$$;

revoke all on function public.set_bid_window_enforcement(integer, boolean) from public, anon, authenticated;
grant execute on function public.set_bid_window_enforcement(integer, boolean) to authenticated;
