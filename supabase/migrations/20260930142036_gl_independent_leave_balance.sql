-- Keep GL leave independent from the area's aggregate leave balance while
-- preserving personal allowances and per-date CPC/DEV slot availability.
-- The existing UI and round-rule editor define six rounds, so align the
-- database constraints and scheduling controls with those rules.

alter table public.bid_year_settings
  drop constraint if exists bid_year_settings_test_bid_round_check;
alter table public.bid_year_settings
  add constraint bid_year_settings_test_bid_round_check
  check (test_bid_round between 1 and 6);

alter table public.bid_rounds
  drop constraint if exists bid_rounds_round_number_check;
alter table public.bid_rounds
  add constraint bid_rounds_round_number_check
  check (round_number between 1 and 6);

alter table public.bid_windows
  drop constraint if exists bid_windows_round_number_check;
alter table public.bid_windows
  add constraint bid_windows_round_number_check
  check (round_number between 1 and 6);

alter table public.leave_requests
  drop constraint if exists leave_requests_round_number_check;
alter table public.leave_requests
  add constraint leave_requests_round_number_check
  check (round_number between 1 and 6);

alter table public.leave_credit_events
  drop constraint if exists leave_credit_events_round_number_check;
alter table public.leave_credit_events
  add constraint leave_credit_events_round_number_check
  check (round_number between 1 and 6);

alter table public.intake_submissions
  drop constraint if exists intake_submissions_round_number_check;
alter table public.intake_submissions
  add constraint intake_submissions_round_number_check
  check (round_number between 1 and 6);

create or replace function private.area_leave_balance_days(
  year_id uuid,
  target_area_id uuid,
  target_bucket text
)
returns table (total_days numeric, used_days integer, remaining_days numeric)
language sql
stable
security invoker
set search_path = ''
as $function$
  with eligible_bidders as (
    select bidder.id, bidder.leave_slot_allowance
    from public.bidders bidder
    left join public.bidder_bid_year_settings bidder_settings
      on bidder_settings.bid_year_id = year_id
     and bidder_settings.bidder_id = bidder.id
    where bidder.area_id = target_area_id
      and bidder.active
      and bidder.bid_role not in ('GL', 'ADM', 'NB')
      and not coalesce(bidder_settings.is_ghost_bidder, false)
      and case
        when bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
        else 'cpc'
      end = target_bucket
  ),
  totals as (
    select coalesce(sum(bidder.leave_slot_allowance), 0)::numeric / 8 as total_days
    from eligible_bidders bidder
  ),
  usage as (
    select coalesce(sum(request.charged_days), 0)::integer as used_days
    from public.leave_requests request
    join eligible_bidders bidder on bidder.id = request.bidder_id
    where request.bid_year_id = year_id
      and request.status in ('pending', 'approved')
      and not request.is_ghost_bid
  )
  select totals.total_days,
         usage.used_days,
         greatest(totals.total_days - usage.used_days, 0)
  from totals cross join usage
$function$;

revoke all on function private.area_leave_balance_days(uuid, uuid, text)
from public, anon, authenticated;

do $upgrade_leave_submitters$
declare
  public_definition text;
  private_definition text;
  declaration_anchor constant text := '  round_leave_limit integer := 0;';
  balance_declarations constant text := $text$  round_leave_limit integer := 0;
  area_total_days numeric := 0;
  area_used_days integer := 0;
  area_remaining_days numeric := 0;$text$;
  projection_anchor constant text := '  projected_leave_hours := (existing_charged_days + requested_charged_days) * leave_hours_per_day;';
  balance_guard constant text := $text$  projected_leave_hours := (existing_charged_days + requested_charged_days) * leave_hours_per_day;

  if target.bid_role = 'GL'
     and not public.is_ghost_bidder(year_row.id, target.id) then
    select balance.total_days, balance.used_days, balance.remaining_days
    into area_total_days, area_used_days, area_remaining_days
    from private.area_leave_balance_days(year_row.id, target.area_id, target_bucket) balance;

    if area_remaining_days <= 0 then
      error_messages := array_append(
        error_messages,
        format(
          '%s %s leave balance is exhausted (%s used of %s estimated days).',
          target_area,
          upper(target_bucket),
          area_used_days,
          area_total_days
        )
      );
    end if;
  end if;$text$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)'::regprocedure
  ) into public_definition;

  public_definition := replace(public_definition, 'round_no not between 1 and 4', 'round_no not between 1 and 6');
  public_definition := replace(public_definition, 'Round must be between 1 and 4.', 'Round must be between 1 and 6.');
  public_definition := replace(public_definition, '  if batch_round = 4 then', '  if batch_round >= 4 then');
  public_definition := replace(public_definition, 'and b.bid_role not in (''ADM'', ''NB'')', 'and b.bid_role not in (''GL'', ''ADM'', ''NB'')');
  public_definition := replace(public_definition, 'and lr.status = ''pending''', 'and lr.status = ''pending''
      and not lr.is_ghost_bid');

  if position('area_remaining_days numeric' in public_definition) = 0 then
    if position(declaration_anchor in public_definition) = 0 then
      raise exception 'Could not locate the leave submitter declaration block.';
    end if;
    public_definition := replace(public_definition, declaration_anchor, balance_declarations);
  end if;

  if position('private.area_leave_balance_days(' in public_definition) = 0 then
    if position(projection_anchor in public_definition) = 0 then
      raise exception 'Could not locate the leave submitter allowance projection.';
    end if;
    public_definition := replace(public_definition, projection_anchor, balance_guard);
  end if;

  execute public_definition;

  select pg_catalog.pg_get_functiondef(
    'private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)'::regprocedure
  ) into private_definition;

  private_definition := replace(private_definition, 'round_no not between 1 and 4', 'round_no not between 1 and 6');
  private_definition := replace(private_definition, 'Round must be between 1 and 4.', 'Round must be between 1 and 6.');
  private_definition := replace(private_definition, 'elsif batch_round = 4 and', 'elsif batch_round >= 4 and');
  private_definition := replace(
    private_definition,
    'raise exception ''Round 4 can include at most % charged days total.'', private.round_four_limit_for_line(effective_rdo_line_id);',
    'raise exception ''Round % can include at most % charged days total.'', batch_round, private.round_four_limit_for_line(effective_rdo_line_id);'
  );
  execute private_definition;
end
$upgrade_leave_submitters$;

do $upgrade_round_controls$
declare
  routine record;
  definition text;
begin
  for routine in
    select routine_proc.oid, routine_proc.proname
    from pg_catalog.pg_proc routine_proc
    join pg_catalog.pg_namespace namespace on namespace.oid = routine_proc.pronamespace
    where namespace.nspname in ('public', 'private')
      and routine_proc.proname in (
        'set_pilot_round',
        'pilot_round_bypasses_window',
        'generate_bid_window_schedule',
        'generate_consistent_bid_window_schedules',
        'upsert_admin_bid_window',
        'import_bid_time_schedule',
        'replace_approved_leave_request_dates_unchecked',
        'replace_bidder_editor_leave_dates',
        'save_bidder_editor'
      )
  loop
    definition := pg_catalog.pg_get_functiondef(routine.oid);
    definition := replace(definition, 'between 1 and 4', 'between 1 and 6');
    definition := replace(definition, 'between 1 and 5', 'between 1 and 6');
    definition := replace(definition, 'from 1 through 4', 'from 1 through 6');
    definition := replace(definition, 'from 1 through 5', 'from 1 through 6');
    definition := replace(definition, 'jsonb_array_length(round_values) <> 4', 'jsonb_array_length(round_values) <> 6');
    definition := replace(definition, 'exactly four round values', 'exactly six round values');
    definition := replace(definition, 'for round_number_value in 1..4', 'for round_number_value in 1..6');
    definition := replace(definition, 'for check_round in 1..4', 'for check_round in 1..6');
    definition := replace(definition, 'if check_round = 4 then', 'if check_round >= 4 then');
    definition := replace(definition, 'for round_no in 1..5', 'for round_no in 1..6');
    definition := replace(definition, 'pending_bidder.bid_role not in (''ADM'', ''NB'')', 'pending_bidder.bid_role not in (''GL'', ''ADM'', ''NB'')');
    definition := replace(definition, 'and pending_request.status = ''pending''', 'and pending_request.status = ''pending''
      and not pending_request.is_ghost_bid');
    execute definition;
  end loop;
end
$upgrade_round_controls$;

do $upgrade_review$
declare
  definition text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure
  );
  definition := replace(
    definition,
    'if not ghost_bid then',
    'if not ghost_bid and target.bid_role <> ''GL'' then'
  );
  execute definition;
end
$upgrade_review$;

create or replace function private.prevent_gl_leave_slot_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_role text;
begin
  if new.source_leave_request_id is null then
    return new;
  end if;

  select bidder.bid_role
  into source_role
  from public.leave_requests request
  join public.bidders bidder on bidder.id = request.bidder_id
  where request.id = new.source_leave_request_id;

  if source_role is distinct from 'GL' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    return null;
  end if;

  new.bidder_id := null;
  new.slot_initials := null;
  new.status := 'open';
  new.source_leave_request_id := null;
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.prevent_gl_leave_slot_consumption()
from public, anon, authenticated;

drop trigger if exists prevent_gl_leave_slot_consumption on public.leave_slots;
create trigger prevent_gl_leave_slot_consumption
before insert or update of bidder_id, slot_initials, status, source_leave_request_id
on public.leave_slots
for each row execute function private.prevent_gl_leave_slot_consumption();

delete from public.leave_slots slot
using public.leave_requests request, public.bidders bidder
where slot.source_leave_request_id = request.id
  and request.bidder_id = bidder.id
  and bidder.bid_role = 'GL'
  and slot.slot_code like 'OVERRIDE-%';

update public.leave_slots slot
set bidder_id = null,
    slot_initials = null,
    status = 'open',
    source_leave_request_id = null,
    updated_at = now()
from public.leave_requests request, public.bidders bidder
where slot.source_leave_request_id = request.id
  and request.bidder_id = bidder.id
  and bidder.bid_role = 'GL';

create or replace function private.sync_holiday_leave_slots_from_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if not old.is_rdo and (old.is_holiday or old.is_holiday_in_lieu) then
      update public.leave_slots slot
      set bidder_id = null,
          slot_initials = null,
          status = 'open',
          source_leave_request_id = null,
          updated_at = now()
      where slot.source_leave_request_id = old.leave_request_id
        and slot.slot_date = old.leave_date;
    end if;
    return old;
  end if;

  if exists (
    select 1
    from public.leave_requests request
    join public.bidders bidder on bidder.id = request.bidder_id
    where request.id = new.leave_request_id
      and bidder.bid_role = 'GL'
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and not old.is_rdo
     and (old.is_holiday or old.is_holiday_in_lieu)
     and (new.leave_date is distinct from old.leave_date
          or not (not new.is_rdo and (new.is_holiday or new.is_holiday_in_lieu))) then
    update public.leave_slots slot
    set bidder_id = null,
        slot_initials = null,
        status = 'open',
        source_leave_request_id = null,
        updated_at = now()
    where slot.source_leave_request_id = old.leave_request_id
      and slot.slot_date = old.leave_date;
  end if;

  perform private.sync_holiday_leave_slots(new.leave_request_id);
  return new;
end
$function$;

create or replace function private.sync_holiday_leave_slots_from_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.bidders bidder
    where bidder.id = new.bidder_id
      and bidder.bid_role = 'GL'
  ) then
    perform private.sync_holiday_leave_slots(new.id);
  end if;
  return new;
end
$function$;

revoke all on function private.sync_holiday_leave_slots_from_date()
from public, anon, authenticated;
revoke all on function private.sync_holiday_leave_slots_from_request()
from public, anon, authenticated;

create or replace function public.read_public_leave_slots(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
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
$function$;

revoke all on function public.read_public_leave_slots(integer)
from public, anon, authenticated;
grant execute on function public.read_public_leave_slots(integer)
to anon, authenticated;

comment on function public.read_public_leave_slots(integer) is
  'Returns daily slot capacity plus visible GL bid overlays that do not consume capacity.';
