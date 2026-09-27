-- Increase the standard Area A-F daily DEV inventory from two slots to four.
-- Explicit per-date capacity overrides remain unchanged, and TMU remains at two.

alter table public.leave_slot_capacities
  alter column dev_capacity set default 4;

-- Area A-F now default to four DEV slots. Preserve explicit daily capacity
-- overrides and leave TMU at its existing two-slot default.
insert into public.leave_slots (
  bid_year_id,
  area_id,
  slot_date,
  slot_group,
  slot_code,
  status
)
select
  seeded_date.bid_year_id,
  seeded_date.area_id,
  seeded_date.slot_date,
  'dev',
  'D' || slot_number,
  'open'
from (
  select distinct s.bid_year_id, s.area_id, s.slot_date
  from public.leave_slots s
) seeded_date
join public.areas a on a.id = seeded_date.area_id
left join public.leave_slot_capacities capacity
  on capacity.bid_year_id = seeded_date.bid_year_id
 and capacity.area_id = seeded_date.area_id
 and capacity.slot_date = seeded_date.slot_date
cross join lateral pg_catalog.generate_series(
  2,
  coalesce(capacity.dev_capacity, 4)
) as series(slot_number)
where pg_catalog.lower(a.code) in ('area-a', 'area-b', 'area-c', 'area-d', 'area-e', 'area-f')
on conflict (bid_year_id, area_id, slot_date, slot_group, slot_code) do nothing;

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
  standard_dev_capacity integer;
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
  standard_dev_capacity := case when lower(target_area_code) = 'tmu' then 2 else 4 end;

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

  if requested_dev_capacity < standard_dev_capacity then
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

revoke all on function private.set_daily_leave_slot_capacity_unchecked(integer, text, date, integer, integer)
from public, anon;
grant execute on function private.set_daily_leave_slot_capacity_unchecked(integer, text, date, integer, integer)
to authenticated;
