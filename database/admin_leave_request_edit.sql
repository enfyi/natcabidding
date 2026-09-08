-- Durable intake/admin edits for approved leave requests.
-- Apply after schema.sql, rls_area_policies.sql, and leave_submission_preflight.sql.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.replace_approved_leave_request_dates_unchecked(
  requested_leave_request_id uuid,
  requested_start_date date,
  requested_end_date date,
  allow_capacity_override boolean default false
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
  year_row public.bid_years%rowtype;
  target_bucket text;
  target_rdo_line_id uuid;
  old_start_date date;
  old_end_date date;
  old_charged_days integer;
  replacement_charged_days integer;
  replacement_week_count integer := 0;
  other_round_usage integer;
  round_limit integer;
  edit_date date;
  selected_slot_id uuid;
  open_slot_count integer;
  pending_reservation_count integer;
  used_capacity_override boolean := false;
  replacement_start_date date := requested_start_date;
  replacement_end_date date := requested_end_date;
begin
  select b.*
  into actor
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.active
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
    raise exception 'Approved leave dates can only be replaced by intake or an administrator.';
  end if;

  if requested_leave_request_id is null then
    raise exception 'A leave request is required.';
  end if;

  select lr.*
  into request_row
  from public.leave_requests lr
  where lr.id = requested_leave_request_id
  for update;

  if request_row.id is null then
    raise exception 'The leave request was not found.';
  end if;

  if request_row.status <> 'approved' then
    raise exception 'Only approved leave requests can be replaced with this operation.';
  end if;

  select b.*
  into strict target
  from public.bidders b
  where b.id = request_row.bidder_id
    and b.active;

  if actor.role <> 'admin' and actor.area_id is distinct from target.area_id then
    raise exception 'Intake users can only replace approved leave in their own area.';
  end if;

  select byear.*
  into strict year_row
  from public.bid_years byear
  where byear.id = request_row.bid_year_id;

  if requested_start_date is null
     or requested_end_date is null
     or requested_end_date < requested_start_date then
    raise exception 'Choose a valid start and end date.';
  end if;

  if requested_start_date < pg_catalog.make_date(year_row.bid_year, 1, 10)
     or requested_end_date > pg_catalog.make_date(year_row.bid_year + 1, 1, 8) then
    raise exception 'Leave must stay between Jan 10, % and Jan 8, %.',
      year_row.bid_year, year_row.bid_year + 1;
  end if;

  if requested_end_date - requested_start_date + 1 > 366 then
    raise exception 'The replacement leave range is too large.';
  end if;

  target_bucket := case
    when target.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
    else 'cpc'
  end;

  select rl.id
  into target_rdo_line_id
  from public.rdo_lines rl
  where rl.bid_year_id = request_row.bid_year_id
    and rl.area_id = target.area_id
    and rl.assigned_bidder_id = target.id
    and rl.status = 'taken'
  order by rl.updated_at desc, rl.id
  limit 1;

  if request_row.round_number <> 1
     and target_rdo_line_id is not null
     and exists (
       select 1
       from pg_catalog.generate_series(
         requested_start_date::timestamp,
         requested_end_date::timestamp,
         interval '1 day'
       ) generated_date
       join public.rdo_line_days line_day
         on line_day.rdo_line_id = target_rdo_line_id
        and line_day.is_rdo
        and line_day.weekday = extract(dow from generated_date)::smallint
     ) then
    raise exception 'Replacement leave dates cannot include the bidder''s RDO after Round 1.';
  end if;

  if exists (
    select 1
    from public.leave_request_dates existing_date
    join public.leave_requests existing_request
      on existing_request.id = existing_date.leave_request_id
    where existing_request.bid_year_id = request_row.bid_year_id
      and existing_request.bidder_id = request_row.bidder_id
      and existing_request.id <> request_row.id
      and existing_request.status in ('pending', 'approved')
      and existing_date.leave_date between requested_start_date and requested_end_date
  ) then
    raise exception 'The bidder already has one or more replacement dates in another pending or approved request.';
  end if;

  select count(*)::integer
  into replacement_charged_days
  from pg_catalog.generate_series(
    requested_start_date::timestamp,
    requested_end_date::timestamp,
    interval '1 day'
  ) generated_date
  where not exists (
      select 1
      from public.holidays holiday
      where holiday.bid_year_id = request_row.bid_year_id
        and holiday.holiday_date = generated_date::date
    )
    and not exists (
      select 1
      from public.holiday_in_lieu_days in_lieu
      where in_lieu.bid_year_id = request_row.bid_year_id
        and in_lieu.bidder_id = request_row.bidder_id
        and in_lieu.in_lieu_date = generated_date::date
    )
    and not (
      request_row.round_number = 1
      and target_rdo_line_id is not null
      and exists (
        select 1
        from public.rdo_line_days line_day
        where line_day.rdo_line_id = target_rdo_line_id
          and line_day.is_rdo
          and line_day.weekday = extract(dow from generated_date)::smallint
      )
    );

  if request_row.round_number = 1 then
    replacement_week_count := pg_catalog.ceil(
      (requested_end_date - requested_start_date + 1)::numeric / 7
    )::integer;

    select count(*)::integer
    into other_round_usage
    from public.leave_request_week_buckets bucket
    join public.leave_requests other_request
      on other_request.id = bucket.leave_request_id
    where other_request.bid_year_id = request_row.bid_year_id
      and other_request.bidder_id = request_row.bidder_id
      and other_request.round_number = 1
      and other_request.status in ('pending', 'approved')
      and other_request.id <> request_row.id;

    if other_round_usage + replacement_week_count > 2 then
      raise exception 'Round 1 can include no more than 2 bid weeks.';
    end if;
  else
    round_limit := case when request_row.round_number in (2, 3) then 10 else 5 end;

    select coalesce(sum(other_request.charged_days), 0)::integer
    into other_round_usage
    from public.leave_requests other_request
    where other_request.bid_year_id = request_row.bid_year_id
      and other_request.bidder_id = request_row.bidder_id
      and other_request.round_number = request_row.round_number
      and other_request.status in ('pending', 'approved')
      and other_request.id <> request_row.id;

    if other_round_usage + replacement_charged_days > round_limit then
      raise exception 'Round % can include no more than % charged leave days.',
        request_row.round_number, round_limit;
    end if;
  end if;

  -- Lock every affected daily inventory in a stable order. This serializes the
  -- release and replacement against submissions and other reviewer edits.
  for edit_date in
    select distinct locked_date
    from (
      select request_date.leave_date as locked_date
      from public.leave_request_dates request_date
      where request_date.leave_request_id = request_row.id
      union
      select generated_date::date as locked_date
      from pg_catalog.generate_series(
        requested_start_date::timestamp,
        requested_end_date::timestamp,
        interval '1 day'
      ) generated_date
    ) affected_dates
    order by locked_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        request_row.bid_year_id::text || ':' || target.area_id::text || ':' || target_bucket || ':' || edit_date::text,
        0
      )
    );
  end loop;

  old_start_date := request_row.requested_start_date;
  old_end_date := request_row.requested_end_date;
  old_charged_days := request_row.charged_days;

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

  delete from public.leave_request_dates request_date
  where request_date.leave_request_id = request_row.id;

  delete from public.leave_request_week_buckets bucket
  where bucket.leave_request_id = request_row.id;

  if request_row.round_number = 1 then
    insert into public.leave_request_week_buckets (
      leave_request_id,
      bucket_start_date,
      bucket_end_date
    )
    select
      request_row.id,
      bucket_start::date,
      least((bucket_start + interval '6 day')::date, requested_end_date)
    from pg_catalog.generate_series(
      requested_start_date::timestamp,
      requested_end_date::timestamp,
      interval '7 day'
    ) bucket_start;
  end if;

  insert into public.leave_request_dates (
    leave_request_id,
    week_bucket_id,
    leave_date,
    charged,
    is_rdo,
    is_holiday,
    is_holiday_in_lieu
  )
  select
    request_row.id,
    bucket.id,
    generated_date::date,
    not holiday.is_holiday
      and not in_lieu.is_holiday_in_lieu
      and not (request_row.round_number = 1 and rdo.is_rdo),
    rdo.is_rdo,
    holiday.is_holiday,
    in_lieu.is_holiday_in_lieu
  from pg_catalog.generate_series(
    requested_start_date::timestamp,
    requested_end_date::timestamp,
    interval '1 day'
  ) generated_date
  left join lateral (
    select exists (
      select 1
      from public.holidays h
      where h.bid_year_id = request_row.bid_year_id
        and h.holiday_date = generated_date::date
    ) as is_holiday
  ) holiday on true
  left join lateral (
    select exists (
      select 1
      from public.holiday_in_lieu_days h
      where h.bid_year_id = request_row.bid_year_id
        and h.bidder_id = request_row.bidder_id
        and h.in_lieu_date = generated_date::date
    ) as is_holiday_in_lieu
  ) in_lieu on true
  left join lateral (
    select target_rdo_line_id is not null and exists (
      select 1
      from public.rdo_line_days line_day
      where line_day.rdo_line_id = target_rdo_line_id
        and line_day.is_rdo
        and line_day.weekday = extract(dow from generated_date)::smallint
    ) as is_rdo
  ) rdo on true
  left join public.leave_request_week_buckets bucket
    on bucket.leave_request_id = request_row.id
   and generated_date::date between bucket.bucket_start_date and bucket.bucket_end_date;

  for edit_date in
    select request_date.leave_date
    from public.leave_request_dates request_date
    where request_date.leave_request_id = request_row.id
      and request_date.charged
    order by request_date.leave_date
  loop
    select count(*)::integer
    into open_slot_count
    from public.leave_slots slot
    where slot.bid_year_id = request_row.bid_year_id
      and slot.area_id = target.area_id
      and slot.slot_date = edit_date
      and slot.slot_group = target_bucket
      and slot.status = 'open'
      and slot.bidder_id is null
      and slot.source_leave_request_id is null;

    select count(*)::integer
    into pending_reservation_count
    from public.leave_request_dates pending_date
    join public.leave_requests pending_request
      on pending_request.id = pending_date.leave_request_id
    join public.bidders pending_bidder
      on pending_bidder.id = pending_request.bidder_id
    where pending_request.bid_year_id = request_row.bid_year_id
      and pending_request.status = 'pending'
      and pending_request.id <> request_row.id
      and pending_date.leave_date = edit_date
      and pending_date.charged
      and pending_bidder.area_id = target.area_id
      and case
        when pending_bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
        else 'cpc'
      end = target_bucket;

    selected_slot_id := null;
    if open_slot_count - pending_reservation_count > 0 then
      select slot.id
      into selected_slot_id
      from public.leave_slots slot
      where slot.bid_year_id = request_row.bid_year_id
        and slot.area_id = target.area_id
        and slot.slot_date = edit_date
        and slot.slot_group = target_bucket
        and slot.status = 'open'
        and slot.bidder_id is null
        and slot.source_leave_request_id is null
      order by slot.slot_code
      limit 1
      for update skip locked;
    end if;

    if selected_slot_id is not null then
      update public.leave_slots slot
      set bidder_id = target.id,
          slot_initials = target.initials,
          status = 'approved',
          source_leave_request_id = request_row.id,
          updated_at = now()
      where slot.id = selected_slot_id;
    elsif coalesce(allow_capacity_override, false) then
      used_capacity_override := true;
      insert into public.leave_slots (
        bid_year_id,
        area_id,
        slot_date,
        slot_group,
        slot_code,
        bidder_id,
        slot_initials,
        status,
        source_leave_request_id,
        updated_at
      ) values (
        request_row.bid_year_id,
        target.area_id,
        edit_date,
        target_bucket,
        'OVERRIDE-' || replace(request_row.id::text, '-', ''),
        target.id,
        target.initials,
        'approved',
        request_row.id,
        now()
      );
    else
      raise exception 'No % leave slot is available on %. Select the capacity override to approve this replacement.',
        upper(target_bucket), to_char(edit_date, 'Mon FMDD, YYYY');
    end if;
  end loop;

  update public.leave_requests request
  set requested_start_date = replacement_start_date,
      requested_end_date = replacement_end_date,
      charged_days = replacement_charged_days,
      reviewed_by = actor.id,
      reviewed_at = now(),
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
    target.area_id,
    actor.id,
    'approved_leave_dates_replaced',
    'leave_requests',
    request_row.id,
    jsonb_build_object(
      'bidder_id', target.id,
      'bidder_initials', target.initials,
      'old_start_date', old_start_date,
      'old_end_date', old_end_date,
      'old_charged_days', old_charged_days,
      'new_start_date', replacement_start_date,
      'new_end_date', replacement_end_date,
      'new_charged_days', replacement_charged_days,
      'capacity_override_requested', coalesce(allow_capacity_override, false),
      'capacity_override_used', used_capacity_override
    )
  );

  return jsonb_build_object(
    'leave_request_id', request_row.id,
    'start_date', replacement_start_date,
    'end_date', replacement_end_date,
    'charged_days', replacement_charged_days,
    'week_count', replacement_week_count,
    'capacity_override_used', used_capacity_override
  );
end;
$function$;

revoke all on function private.replace_approved_leave_request_dates_unchecked(uuid, date, date, boolean)
from public, anon;
grant execute on function private.replace_approved_leave_request_dates_unchecked(uuid, date, date, boolean)
to authenticated;

create or replace function public.replace_approved_leave_request_dates(
  requested_leave_request_id uuid,
  requested_start_date date,
  requested_end_date date,
  allow_capacity_override boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.replace_approved_leave_request_dates_unchecked(
    requested_leave_request_id,
    requested_start_date,
    requested_end_date,
    allow_capacity_override
  )
$function$;

revoke all on function public.replace_approved_leave_request_dates(uuid, date, date, boolean)
from public, anon;
grant execute on function public.replace_approved_leave_request_dates(uuid, date, date, boolean)
to authenticated;

comment on function public.replace_approved_leave_request_dates(uuid, date, date, boolean) is
  'Atomically replaces an approved leave request range, date details, week buckets, assigned slots, and audit history for an authorized intake user or administrator.';
