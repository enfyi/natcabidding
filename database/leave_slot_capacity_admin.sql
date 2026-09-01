-- Per-area, per-date CPC/DEV leave capacity and the admin-only resize operation.

create table if not exists public.leave_slot_capacities (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references public.bid_years(id) on delete cascade,
  area_id uuid not null references public.areas(id) on delete cascade,
  slot_date date not null,
  cpc_capacity integer not null default 3 check (cpc_capacity between 0 and 99),
  dev_capacity integer not null default 2 check (dev_capacity between 0 and 99),
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bid_year_id, area_id, slot_date)
);

create index if not exists leave_slot_capacities_date_idx
  on public.leave_slot_capacities(bid_year_id, area_id, slot_date);

create index if not exists leave_slot_capacities_area_idx
  on public.leave_slot_capacities(area_id);

create index if not exists leave_slot_capacities_updated_by_idx
  on public.leave_slot_capacities(updated_by);

alter table public.leave_slot_capacities enable row level security;

drop policy if exists "public can read leave slot capacities" on public.leave_slot_capacities;
create policy "public can read leave slot capacities"
on public.leave_slot_capacities for select
to anon
using (true);

drop policy if exists "users can read leave slot capacities" on public.leave_slot_capacities;
create policy "users can read leave slot capacities"
on public.leave_slot_capacities for select
to authenticated
using (true);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.set_daily_leave_slot_capacity_unchecked(
  requested_bid_year integer,
  requested_area_name text,
  requested_slot_date date,
  requested_cpc_capacity integer,
  requested_dev_capacity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target_bid_year_id uuid;
  target_area_id uuid;
  target_area_code text;
  standard_cpc_capacity integer;
  cpc_used integer;
  dev_used integer;
begin
  if not public.is_current_admin() then
    raise exception 'Only system admins can change daily leave slot capacity.';
  end if;

  if requested_slot_date is null then
    raise exception 'A slot date is required.';
  end if;

  if requested_cpc_capacity is null or requested_cpc_capacity not between 0 and 99
    or requested_dev_capacity is null or requested_dev_capacity not between 0 and 99 then
    raise exception 'CPC and DEV capacities must be between 0 and 99.';
  end if;

  select byear.id into target_bid_year_id
  from public.bid_years byear
  where byear.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % was not found.', requested_bid_year;
  end if;

  select a.id, a.code into target_area_id, target_area_code
  from public.areas a
  where lower(a.name) = lower(trim(requested_area_name))
     or lower(a.code) = lower(trim(requested_area_name));

  if target_area_id is null then
    raise exception 'Area % was not found.', requested_area_name;
  end if;

  standard_cpc_capacity := case when lower(target_area_code) = 'tmu' then 2 else 3 end;

  select
    count(*) filter (where s.slot_group = 'cpc'),
    count(*) filter (where s.slot_group = 'dev')
  into cpc_used, dev_used
  from public.leave_slots s
  where s.bid_year_id = target_bid_year_id
    and s.area_id = target_area_id
    and s.slot_date = requested_slot_date
    and (
      s.bidder_id is not null
      or s.source_leave_request_id is not null
      or nullif(trim(s.slot_initials), '') is not null
      or s.status in ('pending', 'approved', 'held')
    );

  if requested_cpc_capacity < cpc_used or requested_dev_capacity < dev_used then
    raise exception 'Capacity cannot be lower than filled slots (% CPC and % DEV).', cpc_used, dev_used;
  end if;

  insert into public.leave_slot_capacities (
    bid_year_id,
    area_id,
    slot_date,
    cpc_capacity,
    dev_capacity,
    updated_by,
    updated_at
  ) values (
    target_bid_year_id,
    target_area_id,
    requested_slot_date,
    requested_cpc_capacity,
    requested_dev_capacity,
    actor_id,
    now()
  )
  on conflict on constraint leave_slot_capacities_bid_year_id_area_id_slot_date_key do update
  set cpc_capacity = excluded.cpc_capacity,
      dev_capacity = excluded.dev_capacity,
      updated_by = excluded.updated_by,
      updated_at = now();

  delete from public.leave_slots s
  where s.bid_year_id = target_bid_year_id
    and s.area_id = target_area_id
    and s.slot_date = requested_slot_date
    and s.bidder_id is null
    and s.source_leave_request_id is null
    and nullif(trim(s.slot_initials), '') is null
    and s.status not in ('pending', 'approved', 'held');

  insert into public.leave_slots (
    bid_year_id,
    area_id,
    slot_date,
    slot_group,
    slot_code,
    status
  )
  select
    target_bid_year_id,
    target_area_id,
    requested_slot_date,
    'cpc',
    candidates.slot_code,
    'open'
  from (
    select 'C' || series.slot_number as slot_code
    from generate_series(1, 199) as series(slot_number)
    where not exists (
      select 1 from public.leave_slots existing
      where existing.bid_year_id = target_bid_year_id
        and existing.area_id = target_area_id
        and existing.slot_date = requested_slot_date
        and existing.slot_group = 'cpc'
        and existing.slot_code = 'C' || series.slot_number
    )
    order by series.slot_number
    limit greatest(requested_cpc_capacity - cpc_used, 0)
  ) candidates;

  insert into public.leave_slots (
    bid_year_id,
    area_id,
    slot_date,
    slot_group,
    slot_code,
    status
  )
  select
    target_bid_year_id,
    target_area_id,
    requested_slot_date,
    'dev',
    candidates.slot_code,
    'open'
  from (
    select 'D' || series.slot_number as slot_code
    from generate_series(1, 199) as series(slot_number)
    where not exists (
      select 1 from public.leave_slots existing
      where existing.bid_year_id = target_bid_year_id
        and existing.area_id = target_area_id
        and existing.slot_date = requested_slot_date
        and existing.slot_group = 'dev'
        and existing.slot_code = 'D' || series.slot_number
    )
    order by series.slot_number
    limit greatest(requested_dev_capacity - dev_used, 0)
  ) candidates;

  if requested_cpc_capacity < standard_cpc_capacity then
    insert into public.leave_slots (
      bid_year_id,
      area_id,
      slot_date,
      slot_group,
      slot_code,
      status
    ) values (
      target_bid_year_id,
      target_area_id,
      requested_slot_date,
      'cpc',
      'CAPACITY-' || requested_cpc_capacity,
      'unavailable'
    );
  end if;

  if requested_dev_capacity < 2 then
    insert into public.leave_slots (
      bid_year_id,
      area_id,
      slot_date,
      slot_group,
      slot_code,
      status
    ) values (
      target_bid_year_id,
      target_area_id,
      requested_slot_date,
      'dev',
      'CAPACITY-' || requested_dev_capacity,
      'unavailable'
    );
  end if;

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    target_bid_year_id,
    target_area_id,
    actor_id,
    'leave_slot_capacity_updated',
    'leave_slot_capacities',
    (select lsc.id from public.leave_slot_capacities lsc
      where lsc.bid_year_id = target_bid_year_id
        and lsc.area_id = target_area_id
        and lsc.slot_date = requested_slot_date),
    jsonb_build_object(
      'slot_date', requested_slot_date,
      'cpc_capacity', requested_cpc_capacity,
      'dev_capacity', requested_dev_capacity,
      'cpc_filled', cpc_used,
      'dev_filled', dev_used
    )
  );

  return jsonb_build_object(
    'area_name', requested_area_name,
    'slot_date', requested_slot_date,
    'cpc_capacity', requested_cpc_capacity,
    'dev_capacity', requested_dev_capacity,
    'cpc_filled', cpc_used,
    'dev_filled', dev_used
  );
end;
$$;

grant select on table public.leave_slot_capacities to anon, authenticated;

revoke all on function private.set_daily_leave_slot_capacity_unchecked(integer, text, date, integer, integer)
from public, anon;
grant execute on function private.set_daily_leave_slot_capacity_unchecked(integer, text, date, integer, integer)
to authenticated;

create or replace function public.set_daily_leave_slot_capacity(
  requested_bid_year integer,
  requested_area_name text,
  requested_slot_date date,
  requested_cpc_capacity integer,
  requested_dev_capacity integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_daily_leave_slot_capacity_unchecked(
    requested_bid_year,
    requested_area_name,
    requested_slot_date,
    requested_cpc_capacity,
    requested_dev_capacity
  )
$$;

revoke all on function public.set_daily_leave_slot_capacity(integer, text, date, integer, integer)
from public, anon;
grant execute on function public.set_daily_leave_slot_capacity(integer, text, date, integer, integer)
to authenticated;

create or replace function private.set_leave_slot_capacity_range_unchecked(
  requested_bid_year integer,
  requested_area_name text,
  requested_start_date date,
  requested_end_date date,
  requested_cpc_capacity integer,
  requested_dev_capacity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capacity_date date;
  date_count integer;
begin
  if not public.is_current_admin() then
    raise exception 'Only system admins can change leave slot capacity ranges.';
  end if;

  if requested_start_date is null or requested_end_date is null or requested_end_date < requested_start_date then
    raise exception 'Choose a valid start and end date.';
  end if;

  if requested_start_date < pg_catalog.make_date(requested_bid_year, 1, 10)
    or requested_end_date > pg_catalog.make_date(requested_bid_year + 1, 1, 8) then
    raise exception 'The range must be within the % bid leave year.', requested_bid_year;
  end if;

  date_count := requested_end_date - requested_start_date + 1;

  for capacity_date in
    select generated_date::date
    from pg_catalog.generate_series(
      requested_start_date::timestamp,
      requested_end_date::timestamp,
      interval '1 day'
    ) as generated_date
  loop
    perform private.set_daily_leave_slot_capacity_unchecked(
      requested_bid_year,
      requested_area_name,
      capacity_date,
      requested_cpc_capacity,
      requested_dev_capacity
    );
  end loop;

  return jsonb_build_object(
    'area_name', requested_area_name,
    'start_date', requested_start_date,
    'end_date', requested_end_date,
    'date_count', date_count,
    'cpc_capacity', requested_cpc_capacity,
    'dev_capacity', requested_dev_capacity
  );
end;
$$;

revoke all on function private.set_leave_slot_capacity_range_unchecked(integer, text, date, date, integer, integer)
from public, anon;
grant execute on function private.set_leave_slot_capacity_range_unchecked(integer, text, date, date, integer, integer)
to authenticated;

create or replace function public.set_leave_slot_capacity_range(
  requested_bid_year integer,
  requested_area_name text,
  requested_start_date date,
  requested_end_date date,
  requested_cpc_capacity integer,
  requested_dev_capacity integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_leave_slot_capacity_range_unchecked(
    requested_bid_year,
    requested_area_name,
    requested_start_date,
    requested_end_date,
    requested_cpc_capacity,
    requested_dev_capacity
  )
$$;

revoke all on function public.set_leave_slot_capacity_range(integer, text, date, date, integer, integer)
from public, anon;
grant execute on function public.set_leave_slot_capacity_range(integer, text, date, date, integer, integer)
to authenticated;
