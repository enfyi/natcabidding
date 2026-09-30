-- Complete, read-only leave-slot schedule used by public and authenticated calendars.
-- Returning one JSON value avoids PostgREST's row limit and keeps capacity overrides authoritative.

drop function if exists public.read_public_leave_slots(integer);

create or replace function public.read_public_leave_slots(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target_year as (
    select bid_year.id
    from public.bid_years bid_year
    where bid_year.bid_year = requested_bid_year
  ),
  slot_summary as (
    select
      slot.bid_year_id,
      slot.area_id,
      slot.slot_date,
      count(*) filter (
        where slot.slot_group = 'cpc'
          and slot.slot_code !~ '^CAPACITY-'
      )::integer as cpc_capacity,
      count(*) filter (
        where slot.slot_group = 'dev'
          and slot.slot_code !~ '^CAPACITY-'
      )::integer as dev_capacity,
      count(*) filter (
        where slot.slot_group = 'cpc'
          and slot.slot_code !~ '^CAPACITY-'
          and slot.status = 'open'
          and slot.bidder_id is null
          and slot.source_leave_request_id is null
          and nullif(trim(slot.slot_initials), '') is null
      )::integer as cpc_open,
      count(*) filter (
        where slot.slot_group = 'dev'
          and slot.slot_code !~ '^CAPACITY-'
          and slot.status = 'open'
          and slot.bidder_id is null
          and slot.source_leave_request_id is null
          and nullif(trim(slot.slot_initials), '') is null
      )::integer as dev_open,
      coalesce(
        jsonb_agg(slot.slot_initials order by slot.slot_code) filter (
          where slot.slot_group = 'cpc'
            and slot.slot_code !~ '^CAPACITY-'
            and slot.status in ('approved', 'pending', 'held')
            and nullif(trim(slot.slot_initials), '') is not null
        ),
        '[]'::jsonb
      ) as cpc_initials,
      coalesce(
        jsonb_agg(slot.slot_initials order by slot.slot_code) filter (
          where slot.slot_group = 'dev'
            and slot.slot_code !~ '^CAPACITY-'
            and slot.status in ('approved', 'pending', 'held')
            and nullif(trim(slot.slot_initials), '') is not null
        ),
        '[]'::jsonb
      ) as dev_initials,
      bool_or(slot.status = 'unavailable' and slot.slot_code !~ '^CAPACITY-') as unavailable
    from public.leave_slots slot
    join target_year on target_year.id = slot.bid_year_id
    group by slot.bid_year_id, slot.area_id, slot.slot_date
  ),
  gl_overlay as (
    select
      request.bid_year_id,
      bidder.area_id,
      request_date.leave_date as slot_date,
      jsonb_agg(
        jsonb_build_object(
          'initials', bidder.initials,
          'status', request.status,
          'label', 'GL Bid'
        )
        order by bidder.initials, request.id
      ) as gl_bids
    from public.leave_requests request
    join target_year on target_year.id = request.bid_year_id
    join public.bidders bidder on bidder.id = request.bidder_id
    join public.leave_request_dates request_date on request_date.leave_request_id = request.id
    where bidder.bid_role = 'GL'
      and request.status in ('pending', 'approved')
      and not request_date.is_rdo
    group by request.bid_year_id, bidder.area_id, request_date.leave_date
  ),
  base_schedule as (
    select
      coalesce(capacity.bid_year_id, slots.bid_year_id) as bid_year_id,
      coalesce(capacity.area_id, slots.area_id) as area_id,
      coalesce(capacity.slot_date, slots.slot_date) as slot_date,
      coalesce(capacity.cpc_capacity, slots.cpc_capacity, 0)::integer as cpc_capacity,
      coalesce(capacity.dev_capacity, slots.dev_capacity, 0)::integer as dev_capacity,
      least(
        coalesce(capacity.cpc_capacity, slots.cpc_capacity, 0),
        coalesce(slots.cpc_open, 0)
      )::integer as cpc_open,
      least(
        coalesce(capacity.dev_capacity, slots.dev_capacity, 0),
        coalesce(slots.dev_open, 0)
      )::integer as dev_open,
      coalesce(slots.cpc_initials, '[]'::jsonb) as cpc_initials,
      coalesce(slots.dev_initials, '[]'::jsonb) as dev_initials,
      coalesce(slots.unavailable, false) as unavailable
    from slot_summary slots
    full join public.leave_slot_capacities capacity
      on capacity.bid_year_id = slots.bid_year_id
     and capacity.area_id = slots.area_id
     and capacity.slot_date = slots.slot_date
    join target_year
      on target_year.id = coalesce(capacity.bid_year_id, slots.bid_year_id)
  ),
  schedule as (
    select
      coalesce(base.bid_year_id, gl.bid_year_id) as bid_year_id,
      coalesce(base.area_id, gl.area_id) as area_id,
      coalesce(base.slot_date, gl.slot_date) as slot_date,
      coalesce(base.cpc_capacity, 0) as cpc_capacity,
      coalesce(base.dev_capacity, 0) as dev_capacity,
      coalesce(base.cpc_open, 0) as cpc_open,
      coalesce(base.dev_open, 0) as dev_open,
      coalesce(base.cpc_initials, '[]'::jsonb) as cpc_initials,
      coalesce(base.dev_initials, '[]'::jsonb) as dev_initials,
      coalesce(gl.gl_bids, '[]'::jsonb) as gl_bids,
      coalesce(base.unavailable, false) as unavailable
    from base_schedule base
    full join gl_overlay gl
      on gl.bid_year_id = base.bid_year_id
     and gl.area_id = base.area_id
     and gl.slot_date = base.slot_date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'area_id', schedule.area_id,
        'area_name', area.name,
        'slot_date', schedule.slot_date,
        'cpc_capacity', schedule.cpc_capacity,
        'dev_capacity', schedule.dev_capacity,
        'cpc_open', schedule.cpc_open,
        'dev_open', schedule.dev_open,
        'cpc_initials', schedule.cpc_initials,
        'dev_initials', schedule.dev_initials,
        'gl_bids', schedule.gl_bids,
        'unavailable', schedule.unavailable
      )
      order by area.display_order, schedule.slot_date
    ),
    '[]'::jsonb
  )
  from schedule
  join public.areas area on area.id = schedule.area_id;
$$;

revoke all on function public.read_public_leave_slots(integer) from public, anon, authenticated;
grant execute on function public.read_public_leave_slots(integer) to anon, authenticated;

comment on function public.read_public_leave_slots(integer) is
  'Returns the complete Supabase leave-slot schedule plus visible, non-capacity GL bid overlays as one JSON payload.';
