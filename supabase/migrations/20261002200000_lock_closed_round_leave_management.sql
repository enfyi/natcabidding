-- Intake may manage approved leave only while the bid's own round is open.
create or replace function private.assert_intake_leave_round_open(requested_leave_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.leave_requests%rowtype;
  pilot_database boolean := false;
  pilot_enabled boolean := false;
  pilot_round_open boolean := false;
  first_open timestamptz;
  last_close timestamptz;
begin
  if auth.uid() is null or not coalesce(public.is_current_intake_or_admin(), false) then
    raise exception 'Intake or administrator access is required.';
  end if;

  select request.* into request_row
  from public.leave_requests request
  where request.id = requested_leave_request_id
  for update;
  if request_row.id is null then raise exception 'The leave request was not found.'; end if;
  if request_row.status <> 'approved' then
    raise exception 'Only approved leave bids can be edited or removed.';
  end if;

  select
    coalesce((to_jsonb(settings)->>'pilot_database')::boolean, false),
    coalesce((to_jsonb(settings)->>'pilot_enabled')::boolean, false),
    coalesce((to_jsonb(settings)->'pilot_open_rounds') @> to_jsonb(array[request_row.round_number]), false)
  into pilot_database, pilot_enabled, pilot_round_open
  from public.bid_year_settings settings
  where settings.bid_year_id = request_row.bid_year_id
  for share;

  if coalesce(pilot_database, false) then
    if not coalesce(pilot_enabled, false) or not coalesce(pilot_round_open, false) then
      raise exception 'Round % is closed. Approved leave bids from this round cannot be edited or removed.', request_row.round_number;
    end if;
    return;
  end if;

  select min(bid_window.opens_at), max(bid_window.closes_at)
  into first_open, last_close
  from public.bid_windows bid_window
  join public.bidders bidder on bidder.id = bid_window.bidder_id
  where bid_window.bid_year_id = request_row.bid_year_id
    and bid_window.round_number = request_row.round_number
    and bidder.active
    and bidder.bid_role not in ('ADM', 'NB');

  if first_open is null or last_close is null
     or clock_timestamp() < first_open or clock_timestamp() >= last_close then
    raise exception 'Round % is closed. Approved leave bids from this round cannot be edited or removed.', request_row.round_number;
  end if;
end;
$function$;

revoke all on function private.assert_intake_leave_round_open(uuid) from public, anon, authenticated;
grant execute on function private.assert_intake_leave_round_open(uuid) to authenticated;

create or replace function public.admin_cancel_leave_requests(requested_leave_request_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare request_id uuid;
begin
  for request_id in
    select distinct id from unnest(requested_leave_request_ids) as ids(id) order by id
  loop
    perform private.assert_intake_leave_round_open(request_id);
  end loop;
  return private.admin_cancel_leave_requests_unchecked(requested_leave_request_ids);
end;
$function$;

revoke all on function public.admin_cancel_leave_requests(uuid[]) from public, anon;
grant execute on function public.admin_cancel_leave_requests(uuid[]) to authenticated;

-- Production does not yet have approved-date replacement; keep its API absent.
do $migration$
begin
  if to_regprocedure('private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)') is not null then
    execute $sql$
      create or replace function public.replace_approved_leave_request_dates(
        requested_leave_request_id uuid,
        requested_start_date date,
        requested_end_date date,
        allow_capacity_override boolean default false
      )
      returns jsonb
      language plpgsql
      security invoker
      set search_path = ''
      as $function$
      begin
        perform private.assert_intake_leave_round_open(requested_leave_request_id);
        return private.replace_approved_leave_request_dates_unchecked(
          requested_leave_request_id, requested_start_date, requested_end_date, allow_capacity_override
        );
      end;
      $function$;
    $sql$;
    revoke all on function public.replace_approved_leave_request_dates(uuid, date, date, boolean) from public, anon;
    grant execute on function public.replace_approved_leave_request_dates(uuid, date, date, boolean) to authenticated;
  end if;
end;
$migration$;
