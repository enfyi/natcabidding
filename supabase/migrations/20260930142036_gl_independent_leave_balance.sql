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
    execute definition;
  end loop;
end
$upgrade_round_controls$;
