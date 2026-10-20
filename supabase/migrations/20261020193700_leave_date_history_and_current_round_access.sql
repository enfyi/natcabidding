-- All date-edit entry points enforce the same reviewer and current-round rule.
create or replace function private.assert_intake_leave_date_round(requested_leave_request_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  request_row public.leave_requests%rowtype;
  pilot_database boolean;
  pilot_enabled boolean;
  open_rounds jsonb;
  active_round integer;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into request_row from public.leave_requests where id = requested_leave_request_id for update;
  if request_row.id is null then raise exception 'The leave request was not found.'; end if;
  if not coalesce(private.can_review_intake_year(request_row.bid_year_id), false) then
    raise exception 'Intake or administrator access is required.';
  end if;
  if exists (select 1 from public.bidders actor where actor.auth_user_id = auth.uid()
    and lower(actor.email) = lower(auth.jwt()->>'email') and actor.active and actor.role = 'admin') then
    return;
  end if;
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

-- Add saved date changes to the existing, area-scoped intake reader.
-- Reuse audit records so earlier edits are included without backfilling data.
create or replace function private.read_leave_intake_queue_with_weeks(queue_bid_year integer)
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(
    to_jsonb(queue) || jsonb_build_object(
      'weekBucketStarts', coalesce((
        select jsonb_agg(bucket.bucket_start_date order by bucket.bucket_start_date)
        from public.leave_request_week_buckets bucket
        where bucket.leave_request_id = queue.id
          and queue.round_number = 1 and queue.status in ('pending', 'approved')
      ), '[]'::jsonb),
      'leaveEditHistory', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', event.id, 'editedAt', event.created_at,
          'editedBy', coalesce(editor.initials, 'Former intake/admin'),
          'before', event.before_dates, 'after', event.after_dates
        ) order by event.created_at desc, event.id)
        from (
          select audit.id, audit.actor_id, audit.created_at,
            jsonb_build_object('start_date', audit.details->>'old_start_date', 'end_date', audit.details->>'old_end_date') as before_dates,
            jsonb_build_object('start_date', audit.details->>'new_start_date', 'end_date', audit.details->>'new_end_date') as after_dates
          from public.audit_events audit
          where audit.entity_table = 'leave_requests' and audit.entity_id = queue.id
            and audit.event_type in ('approved_leave_dates_replaced', 'bidder_leave_dates_edited')
            and (audit.details->>'old_start_date', audit.details->>'old_end_date')
              is distinct from (audit.details->>'new_start_date', audit.details->>'new_end_date')
          union all
          select audit.id, audit.actor_id, audit.created_at,
            jsonb_build_object('start_date', prior->>'requested_start_date', 'end_date', prior->>'requested_end_date'),
            jsonb_build_object('start_date', next->>'requested_start_date', 'end_date', next->>'requested_end_date')
          from public.audit_events audit
          cross join lateral jsonb_array_elements(audit.details->'before'->'leave') prior
          cross join lateral jsonb_array_elements(audit.details->'after'->'leave') next
          where audit.event_type = 'bidder_bids_edited' and audit.entity_table = 'bidders'
            and audit.entity_id = queue.bidder_id
            and audit.bid_year_id = (select request.bid_year_id from public.leave_requests request where request.id = queue.id)
            and prior->>'id' = queue.id::text and next->>'id' = queue.id::text
            and (prior->>'requested_start_date', prior->>'requested_end_date')
              is distinct from (next->>'requested_start_date', next->>'requested_end_date')
        ) event
        left join public.bidders editor on editor.id = event.actor_id
      ), '[]'::jsonb)
    ) order by queue.created_at desc, queue.id
  ), '[]'::jsonb)
  from public.read_leave_intake_queue(queue_bid_year) queue
  where (select auth.uid()) is not null;
$function$;
revoke all on function private.read_leave_intake_queue_with_weeks(integer) from public, anon;
grant execute on function private.read_leave_intake_queue_with_weeks(integer) to authenticated;
