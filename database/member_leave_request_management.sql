-- Self-service removal of submitted leave requests while the bidder's
-- matching round window is still open.
-- Apply after schema.sql, rls_area_policies.sql, and leave_submission_preflight.sql.

create index if not exists leave_slots_source_leave_request_idx
  on public.leave_slots(source_leave_request_id)
  where source_leave_request_id is not null;

create index if not exists leave_credit_events_source_request_idx
  on public.leave_credit_events(source_leave_request_id)
  where source_leave_request_id is not null;

create or replace function public.cancel_own_leave_request(
  requested_leave_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  request_row public.leave_requests%rowtype;
  year_row public.bid_years%rowtype;
  enforce_bid_windows boolean := true;
  configured_test_round integer;
  affected_date date;
begin
  select bidder.*
  into actor
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  for update;

  if actor.id is null then
    raise exception 'Authenticated bidder profile required.';
  end if;

  select request.*
  into request_row
  from public.leave_requests request
  where request.id = requested_leave_request_id
  for update;

  if request_row.id is null or request_row.bidder_id <> actor.id then
    raise exception 'The leave request was not found.';
  end if;

  if request_row.status not in ('pending', 'approved') then
    raise exception 'Only pending or approved leave requests can be removed.';
  end if;

  select bid_year.*
  into strict year_row
  from public.bid_years bid_year
  where bid_year.id = request_row.bid_year_id;

  select coalesce(settings.enforce_bid_windows, true), settings.test_bid_round
  into enforce_bid_windows, configured_test_round
  from public.bid_year_settings settings
  where settings.bid_year_id = request_row.bid_year_id;

  enforce_bid_windows := coalesce(enforce_bid_windows, true);

  if enforce_bid_windows and not exists (
    select 1
    from public.bid_windows bid_window
    where bid_window.bid_year_id = request_row.bid_year_id
      and bid_window.bidder_id = actor.id
      and bid_window.round_number = request_row.round_number
      and now() >= bid_window.opens_at
      and now() <= bid_window.closes_at
  ) then
    raise exception 'Leave can only be changed during your allotted Round % bid window.',
      request_row.round_number;
  end if;

  if not enforce_bid_windows
     and configured_test_round is not null
     and configured_test_round <> request_row.round_number then
    raise exception 'Testing mode is currently set to Round %.', configured_test_round;
  end if;

  -- Use the same per-area/date lock key as submissions and admin replacements
  -- so a released slot cannot race another transaction's capacity check.
  for affected_date in
    select request_date.leave_date
    from public.leave_request_dates request_date
    where request_date.leave_request_id = request_row.id
    order by request_date.leave_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        request_row.bid_year_id::text || ':' || actor.area_id::text || ':' ||
        case when actor.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev' else 'cpc' end || ':' ||
        affected_date::text,
        0
      )
    );
  end loop;

  -- Approved requests own daily inventory rows. Return normal slots to the
  -- open pool and remove any synthetic capacity-override slots.
  delete from public.leave_slots slot
  where slot.source_leave_request_id = request_row.id
    and slot.slot_code like 'OVERRIDE-%';

  update public.leave_slots slot
  set bidder_id = null,
      slot_initials = null,
      status = 'open',
      source_leave_request_id = null,
      updated_at = now()
  where slot.source_leave_request_id = request_row.id;

  delete from public.leave_credit_events credit
  where credit.source_leave_request_id = request_row.id;

  update public.leave_requests request
  set status = 'cancelled',
      updated_at = now()
  where request.id = request_row.id;

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    request_row.bid_year_id,
    actor.area_id,
    actor.id,
    'member_leave_request_cancelled',
    'leave_requests',
    request_row.id,
    jsonb_build_object(
      'bid_year', year_row.bid_year,
      'round_number', request_row.round_number,
      'previous_status', request_row.status,
      'requested_start_date', request_row.requested_start_date,
      'requested_end_date', request_row.requested_end_date,
      'charged_days', request_row.charged_days
    )
  );

  return jsonb_build_object(
    'leave_request_id', request_row.id,
    'round_number', request_row.round_number,
    'status', 'cancelled'
  );
end;
$function$;

revoke all on function public.cancel_own_leave_request(uuid)
from public, anon;
grant execute on function public.cancel_own_leave_request(uuid)
to authenticated;

comment on function public.cancel_own_leave_request(uuid) is
  'Lets an authenticated bidder cancel their own pending or approved leave request during its round bid window, releases assigned slots, and records an audit event.';
