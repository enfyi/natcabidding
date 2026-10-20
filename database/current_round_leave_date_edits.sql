-- All date-edit entry points enforce the same reviewer and current-round rule.
create or replace function private.assert_intake_leave_date_round(requested_leave_request_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  request_row public.leave_requests%rowtype;
  actor public.bidders%rowtype;
  pilot_database boolean;
  pilot_enabled boolean;
  open_rounds jsonb;
  active_round integer;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into request_row from public.leave_requests where id = requested_leave_request_id for update;
  if request_row.id is null then raise exception 'The leave request was not found.'; end if;
  select * into actor from public.bidders
  where auth_user_id = auth.uid() and lower(email) = lower(auth.jwt()->>'email') and active;
  if actor.id is null or not (
    actor.role in ('admin', 'intake') or exists (
      select 1 from public.intake_schedules schedule
      where schedule.intake_user_id = actor.id
        and (schedule.bid_year_id = request_row.bid_year_id or schedule.bid_year_id is null)
        and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
    )
  ) then
    raise exception 'Intake or administrator access is required.';
  end if;
  if actor.role = 'admin' then return; end if;
  select coalesce((to_jsonb(settings)->>'pilot_database')::boolean, false),
    coalesce((to_jsonb(settings)->>'pilot_enabled')::boolean, false),
    coalesce(to_jsonb(settings)->'pilot_open_rounds', '[]'::jsonb)
  into pilot_database, pilot_enabled, open_rounds
  from public.bid_year_settings settings where settings.bid_year_id = request_row.bid_year_id for share;
  if coalesce(pilot_database, false) then
    if pilot_enabled then select max(value::integer) into active_round from jsonb_array_elements_text(open_rounds); end if;
  else
    select max(windows.round_number) into active_round from (
      select bid_window.round_number, min(bid_window.opens_at) as opens_at, max(bid_window.closes_at) as closes_at
      from public.bid_windows bid_window join public.bidders bidder on bidder.id = bid_window.bidder_id
      where bid_window.bid_year_id = request_row.bid_year_id and bidder.active and bidder.bid_role not in ('ADM', 'NB')
      group by bid_window.round_number
    ) windows where now() >= windows.opens_at and now() < windows.closes_at;
  end if;
  if active_round is null or request_row.round_number <> active_round then
    raise exception 'Intake can only change leave dates in the current round. Round % requires an administrator.', request_row.round_number;
  end if;
end;
$function$;
revoke all on function private.assert_intake_leave_date_round(uuid) from public, anon;
grant execute on function private.assert_intake_leave_date_round(uuid) to authenticated;

-- Preserve the approved-only contract of the existing edit/removal guard.
create or replace function private.assert_intake_leave_round_open(requested_leave_request_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.assert_intake_leave_date_round(requested_leave_request_id);
  if not exists (select 1 from public.leave_requests where id = requested_leave_request_id and status = 'approved') then
    raise exception 'Only approved leave bids can be edited or removed.';
  end if;
end;
$function$;

-- Guard the direct date RPC and the bidder editor before it stages leave rows.
-- Unchanged past-round leave can still be recalculated after an RDO edit.
do $migration$
declare definition text; updated text; signature text;
begin
  signature := 'private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)';
  definition := pg_get_functiondef(signature::regprocedure);
  if position('perform private.assert_intake_leave_date_round' in definition) = 0 then
    updated := replace(definition, E'begin\n', E'begin\n  perform private.assert_intake_leave_date_round(requested_leave_request_id);\n');
    if updated = definition then raise exception 'Approved-date function marker not found.'; end if;
    execute updated;
  end if;
  signature := 'private.replace_bidder_editor_leave_dates(uuid,date,date,boolean,uuid)';
  definition := pg_get_functiondef(signature::regprocedure);
  if position('perform private.assert_intake_leave_date_round' in definition) = 0 then
    updated := replace(definition, '  select b.*
  into strict target', $guard$
  if (requested_edit_start_date, requested_edit_end_date) is distinct from
     (request_row.requested_start_date, request_row.requested_end_date) then
    perform private.assert_intake_leave_date_round(requested_leave_request_id);
  end if;
  select b.*
  into strict target$guard$);
    if updated = definition then raise exception 'Leave helper marker not found.'; end if;
    execute updated;
  end if;
  signature := 'private.save_bidder_editor(integer,uuid,jsonb,jsonb)';
  definition := pg_get_functiondef(signature::regprocedure);
  if position('perform private.assert_intake_leave_date_round' in definition) = 0 then
    updated := replace(definition, E'  line_change := changes->''rdo'';', $guard$
  for entry in select value from jsonb_array_elements(changes->'leave') loop
    select value into prior from jsonb_array_elements(before_state->'leave') where value->>'id'=entry->>'id';
    if (entry->>'start_date', entry->>'end_date') is distinct from
       (prior->>'requested_start_date', prior->>'requested_end_date') then
      perform private.assert_intake_leave_date_round((entry->>'id')::uuid);
    end if;
  end loop;
  line_change := changes->'rdo';$guard$);
    if updated = definition then raise exception 'Bidder editor marker not found.'; end if;
    execute updated;
  end if;
end;
$migration$;
