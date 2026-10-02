-- Intake/admin removal of approved leave bids while retaining request history.
-- Apply after schema.sql, rls_area_policies.sql, and admin_leave_request_edit.sql.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.admin_cancel_leave_requests_unchecked(
  requested_leave_request_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  request_row public.leave_requests%rowtype;
  target public.bidders%rowtype;
  affected_date date;
  matched_request_count integer;
  cancelled_ids uuid[] := array[]::uuid[];
begin
  if requested_leave_request_ids is null
     or cardinality(requested_leave_request_ids) = 0 then
    raise exception 'Choose at least one approved leave request to remove.';
  end if;

  if cardinality(requested_leave_request_ids) <> (
    select count(distinct value)::integer
    from unnest(requested_leave_request_ids) requested(value)
  ) then
    raise exception 'Each approved leave request can only be removed once.';
  end if;

  select bidder.*
  into actor
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  for update;

  if actor.id is null or not (
    actor.role in ('admin', 'intake')
    or exists (
      select 1
      from public.intake_schedules schedule
      where schedule.intake_user_id = actor.id
        and now() >= schedule.starts_at - interval '15 minutes'
        and now() <= schedule.ends_at
    )
  ) then
    raise exception 'Approved leave bids can only be removed by intake or an administrator.';
  end if;

  select count(*)::integer
  into matched_request_count
  from public.leave_requests request
  where request.id = any(requested_leave_request_ids);

  if matched_request_count <> cardinality(requested_leave_request_ids) then
    raise exception 'One or more leave requests were not found.';
  end if;

  for request_row in
    select request.*
    from public.leave_requests request
    where request.id = any(requested_leave_request_ids)
    order by request.id
    for update
  loop
    if request_row.status <> 'approved' then
      raise exception 'Only approved leave requests can be removed from pre-approved slots.';
    end if;

    select bidder.*
    into strict target
    from public.bidders bidder
    where bidder.id = request_row.bidder_id;

    if actor.role <> 'admin'
       and actor.area_id is distinct from target.area_id then
      raise exception 'Intake users can only remove approved leave in their own area.';
    end if;

    for affected_date in
      select request_date.leave_date
      from public.leave_request_dates request_date
      where request_date.leave_request_id = request_row.id
      order by request_date.leave_date
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          request_row.bid_year_id::text || ':' || target.area_id::text || ':' ||
          case when target.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev' else 'cpc' end || ':' ||
          affected_date::text,
          0
        )
      );
    end loop;

    -- Synthetic override slots disappear; ordinary slots return to inventory.
    delete from public.leave_slots slot
    where slot.source_leave_request_id = request_row.id
      and (
        slot.slot_code like 'OVERRIDE-%'
        or slot.slot_code like 'OVR-%'
      );

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
        reviewed_by = actor.id,
        reviewed_at = now(),
        updated_at = now()
    where request.id = request_row.id;

    update public.intake_submissions submission
    set status = 'cancelled',
        reviewed_by = actor.id,
        reviewed_at = now(),
        updated_at = now()
    where submission.leave_request_id = request_row.id
      and submission.status in ('pending', 'approved');

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
      target.area_id,
      actor.id,
      'admin_leave_request_cancelled',
      'leave_requests',
      request_row.id,
      jsonb_build_object(
        'bidder_id', target.id,
        'bidder_initials', target.initials,
        'previous_status', request_row.status,
        'requested_start_date', request_row.requested_start_date,
        'requested_end_date', request_row.requested_end_date,
        'charged_days', request_row.charged_days,
        'history_retained', true,
        'slots_released', true
      )
    );

    cancelled_ids := array_append(cancelled_ids, request_row.id);
  end loop;

  return jsonb_build_object(
    'cancelled_leave_request_ids', to_jsonb(cancelled_ids),
    'cancelled_count', cardinality(cancelled_ids),
    'status', 'cancelled'
  );
end;
$function$;

revoke all on function private.admin_cancel_leave_requests_unchecked(uuid[])
from public, anon;
grant execute on function private.admin_cancel_leave_requests_unchecked(uuid[])
to authenticated;

create or replace function public.admin_cancel_leave_requests(
  requested_leave_request_ids uuid[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_cancel_leave_requests_unchecked(requested_leave_request_ids)
$function$;

revoke all on function public.admin_cancel_leave_requests(uuid[])
from public, anon;
grant execute on function public.admin_cancel_leave_requests(uuid[])
to authenticated;

comment on function public.admin_cancel_leave_requests(uuid[]) is
  'Cancels one or more approved leave requests for authorized intake/admin users, releases occupied leave slots, and retains request and audit history.';
