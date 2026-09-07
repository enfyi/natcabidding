-- Bidder editor: complete-record validation and atomic, audited saves.
-- Requires the existing bidding routines and leave_submission_preflight.sql.
-- The private date helper follows admin_leave_request_edit.sql, preserving pending status.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.replace_bidder_editor_leave_dates(
  requested_leave_request_id uuid,
  requested_edit_start_date date,
  requested_edit_end_date date,
  allow_capacity_override boolean default false,
  proposed_rdo_line_id uuid default null
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
  replacement_start_date date := requested_edit_start_date;
  replacement_end_date date := requested_edit_end_date;
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
    raise exception 'Leave dates can only be edited by intake or an administrator.';
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

  if requested_edit_start_date is null
     or requested_edit_end_date is null
     or requested_edit_end_date < requested_edit_start_date then
    raise exception 'Choose a valid start and end date.';
  end if;

  if requested_edit_start_date < pg_catalog.make_date(year_row.bid_year, 1, 10)
     or requested_edit_end_date > pg_catalog.make_date(year_row.bid_year + 1, 1, 8) then
    raise exception 'Leave must stay between Jan 10, % and Jan 8, %.',
      year_row.bid_year, year_row.bid_year + 1;
  end if;

  if requested_edit_end_date - requested_edit_start_date + 1 > 366 then
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

  target_rdo_line_id := coalesce(target_rdo_line_id, proposed_rdo_line_id);
  if target_rdo_line_id is null and request_row.status in ('pending','approved') then raise exception 'Select an RDO line before editing leave.'; end if;

  if request_row.status in ('pending','approved') and request_row.round_number <> 1
     and target_rdo_line_id is not null
     and exists (
       select 1
       from pg_catalog.generate_series(
         requested_edit_start_date::timestamp,
         requested_edit_end_date::timestamp,
         interval '1 day'
       ) generated_date
       join public.rdo_line_days line_day
         on line_day.rdo_line_id = target_rdo_line_id
        and line_day.is_rdo
        and line_day.weekday = extract(dow from generated_date)::smallint
     ) then
    raise exception 'Replacement leave dates cannot include the bidder''s RDO after Round 1.';
  end if;

  if request_row.status in ('pending','approved') and exists (
    select 1
    from public.leave_request_dates existing_date
    join public.leave_requests existing_request
      on existing_request.id = existing_date.leave_request_id
    where existing_request.bid_year_id = request_row.bid_year_id
      and existing_request.bidder_id = request_row.bidder_id
      and existing_request.id <> request_row.id
      and existing_request.status in ('pending', 'approved')
      and existing_date.leave_date between requested_edit_start_date and requested_edit_end_date
  ) then
    raise exception 'The bidder already has one or more replacement dates in another pending or approved request.';
  end if;

  select count(*)::integer
  into replacement_charged_days
  from pg_catalog.generate_series(
    requested_edit_start_date::timestamp,
    requested_edit_end_date::timestamp,
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
      (requested_edit_end_date - requested_edit_start_date + 1)::numeric / 7
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

    if request_row.status in ('pending','approved') and other_round_usage + replacement_week_count > 2 then
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

    if request_row.status in ('pending','approved') and other_round_usage + replacement_charged_days > round_limit then
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
        requested_edit_start_date::timestamp,
        requested_edit_end_date::timestamp,
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
      least((bucket_start + interval '6 day')::date, requested_edit_end_date)
    from pg_catalog.generate_series(
      requested_edit_start_date::timestamp,
      requested_edit_end_date::timestamp,
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
    requested_edit_start_date::timestamp,
    requested_edit_end_date::timestamp,
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
      and request_row.status in ('pending','approved')
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
      if request_row.status = 'approved' then
      update public.leave_slots slot
      set bidder_id = target.id,
          slot_initials = target.initials,
          status = 'approved',
          source_leave_request_id = request_row.id,
          updated_at = now()
      where slot.id = selected_slot_id;
      end if;
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
      reviewed_by = case when request_row.status = 'approved' then actor.id else request_row.reviewed_by end,
      reviewed_at = case when request_row.status = 'approved' then now() else request_row.reviewed_at end,
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
    'bidder_leave_dates_edited',
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


revoke all on function private.replace_bidder_editor_leave_dates(uuid,date,date,boolean,uuid) from public, anon, authenticated;

create or replace function private.bidder_editor_actor(target_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor public.bidders%rowtype;
begin
  select * into actor from public.bidders where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt()->>'email') and active;
  if actor.id is null or not (actor.role in ('admin','intake') or exists (
    select 1 from public.intake_schedules s where s.intake_user_id=actor.id
      and now() between s.starts_at - interval '15 minutes' and s.ends_at
  )) then raise exception 'Active intake or administrator access is required.'; end if;
  if target_id is not null and not exists (
    select 1 from public.bidders b where b.id=target_id and b.active
      and (actor.role='admin' or b.area_id=actor.area_id)
  ) then raise exception 'This bidder is outside your authorized area or is inactive.'; end if;
  return actor.id;
end $$;
revoke all on function private.bidder_editor_actor(uuid) from public, anon, authenticated;

create or replace function private.bidder_editor_snapshot(year_id uuid, target_id uuid)
returns jsonb language sql stable set search_path = '' as $$
select jsonb_build_object(
  'bidder_id', target_id,
  'bidder_version', (select b.updated_at from public.bidders b where b.id=target_id),
  'assignment', (select to_jsonb(x) from (
    select id, line_code, fatigue_group, flex, aws, mid, four_ten, updated_at
    from public.rdo_lines where bid_year_id=year_id and assigned_bidder_id=target_id
      and status='taken' order by updated_at desc,id limit 1
  ) x),
  'rdo', (select to_jsonb(x) from (
    select id, rdo_line_id, round_number, status, payload, updated_at
    from public.intake_submissions where bid_year_id=year_id and bidder_id=target_id
      and submission_type='rdo' and status in ('pending','approved')
    order by submitted_at desc nulls last,created_at desc,id limit 1
  ) x),
  'leave', coalesce((select jsonb_agg(to_jsonb(x) order by round_number,priority,id) from (
    select id, round_number, priority, status, requested_start_date, requested_end_date, charged_days, updated_at
    from public.leave_requests where bid_year_id=year_id and bidder_id=target_id
  ) x),'[]'::jsonb)
) $$;
revoke all on function private.bidder_editor_snapshot(uuid,uuid) from public, anon, authenticated;

create or replace function public.read_admin_bidder_editor(requested_bid_year integer, target_bidder_id uuid default null, search_text text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; year_id uuid; result jsonb;
begin
  actor_id := private.bidder_editor_actor(target_bidder_id);
  select id into strict year_id from public.bid_years where bid_year=requested_bid_year;
  if target_bidder_id is null then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into result from (
      select b.id,b.first_name,b.last_name,b.initials,a.name area,b.bid_role
      from public.bidders b join public.areas a on a.id=b.area_id
      join public.bidders actor on actor.id=actor_id
      where b.active and (actor.role='admin' or b.area_id=actor.area_id)
        and (b.first_name || ' ' || b.last_name || ' ' || coalesce(b.initials,'')) ilike '%' || trim(coalesce(search_text,'')) || '%'
      order by b.last_name,b.first_name,b.id limit 50
    ) x;
    return jsonb_build_object('bidders',result);
  end if;
  return jsonb_build_object('snapshot',private.bidder_editor_snapshot(year_id,target_bidder_id),
    'lines',(select coalesce(jsonb_agg(to_jsonb(x) order by line_code),'[]'::jsonb) from (
      select l.id,l.line_code,l.pattern,l.fatigue_group,l.mid,l.four_ten,l.status,l.assigned_bidder_id
      from public.rdo_lines l join public.bidders b on b.id=target_bidder_id join public.areas a on a.id=b.area_id
      where l.bid_year_id=year_id and l.area_id=b.area_id
        and public.rdo_line_matches_bid_role(b.bid_role,a.name,l.line_type,l.pattern)
    ) x));
end $$;
revoke all on function public.read_admin_bidder_editor(integer,uuid,text) from public,anon;
grant execute on function public.read_admin_bidder_editor(integer,uuid,text) to authenticated;

create or replace function private.save_bidder_editor(requested_bid_year integer, target_bidder_id uuid, expected_snapshot jsonb, changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid; target public.bidders%rowtype; year_id uuid; before_state jsonb;
  line_row public.rdo_lines%rowtype; line_change jsonb; entry jsonb; prior jsonb;
  rdo_id uuid; rdo_status text; group_name text; area_max integer; crew_max integer;
  start_day date; end_day date; round_no integer; day_hours integer; used_hours integer; credit_days integer;
  bucket text; d date; r record;
begin
  actor_id := private.bidder_editor_actor(target_bidder_id);
  select * into strict target from public.bidders where id=target_bidder_id for update;
  select id into strict year_id from public.bid_years where bid_year=requested_bid_year;
  perform id from public.rdo_lines where bid_year_id=year_id and area_id=target.area_id order by id for update;
  perform id from public.intake_submissions where bid_year_id=year_id and bidder_id=target.id order by id for update;
  perform id from public.leave_requests where bid_year_id=year_id and bidder_id=target.id order by id for update;
  before_state := private.bidder_editor_snapshot(year_id,target.id);
  if expected_snapshot is distinct from before_state then
    raise exception 'This bidder has changed since you loaded it. Reload the bidder and review the latest values.';
  end if;
  if jsonb_typeof(changes->'leave') is distinct from 'array' then raise exception 'A complete leave record is required.'; end if;
  if (select count(*) from jsonb_array_elements(changes->'leave')) <> jsonb_array_length(before_state->'leave')
    or (select count(distinct value->>'id') from jsonb_array_elements(changes->'leave')) <> jsonb_array_length(before_state->'leave')
    or exists(select 1 from jsonb_array_elements(changes->'leave') e where not exists(
      select 1 from jsonb_array_elements(before_state->'leave') b where b->>'id'=e->>'id')) then
    raise exception 'Leave records were added or removed. Reload the bidder.';
  end if;
  line_change := changes->'rdo';
  if line_change is not null and line_change <> 'null'::jsonb then
    select * into strict line_row from public.rdo_lines where id=(line_change->>'line_id')::uuid
      and bid_year_id=year_id and area_id=target.area_id;
    if not public.rdo_line_matches_bid_role(target.bid_role,(select name from public.areas where id=target.area_id),line_row.line_type,line_row.pattern) then
      raise exception 'This RDO line is not eligible for the bidder role.';
    end if;
    if target.bid_role <> 'GL' and line_row.status <> 'open' and line_row.assigned_bidder_id is distinct from target.id then
      raise exception 'This RDO line is no longer available.';
    end if;
    group_name := line_change->>'fatigue_group';
    if group_name is null or group_name not in ('A','B','C') then raise exception 'Choose fatigue group A, B, or C.'; end if;
    if line_row.fatigue_group like '%only' and group_name <> left(line_row.fatigue_group,1) then
      raise exception 'This line requires fatigue group %.',left(line_row.fatigue_group,1);
    end if;
    if jsonb_typeof(line_change->'flex') is distinct from 'boolean' or jsonb_typeof(line_change->'aws') is distinct from 'boolean'
      or coalesce(line_change->>'mid','') not in ('Yes','No','BID') then raise exception 'Choose valid Flex, AWS, and Mid values.'; end if;
    if line_row.mid='BID' and line_change->>'mid' <> 'BID' then raise exception 'A designated Mid line must retain BID.'; end if;
    if line_row.line_type='CPC' and target.bid_role <> 'GL' then
      select greatest(1,floor(count(*)::numeric/3)::integer) into area_max from public.rdo_lines
        where bid_year_id=year_id and area_id=target.area_id and line_type='CPC';
      select greatest(1,floor(count(*)::numeric/3)::integer) into crew_max from public.rdo_lines
        where bid_year_id=year_id and area_id=target.area_id and line_type='CPC' and pattern=line_row.pattern;
      if (select count(*) from public.rdo_lines where bid_year_id=year_id and area_id=target.area_id and line_type='CPC'
        and status='taken' and fatigue_group=group_name and assigned_bidder_id is distinct from target.id) >= area_max
        or (select count(*) from public.rdo_lines where bid_year_id=year_id and area_id=target.area_id and line_type='CPC'
        and pattern=line_row.pattern and status='taken' and fatigue_group=group_name and assigned_bidder_id is distinct from target.id) >= crew_max then
        raise exception 'Fatigue group % is full for this area or crew.',group_name;
      end if;
    end if;
    rdo_id := (before_state->'rdo'->>'id')::uuid;
    rdo_status := coalesce(before_state->'rdo'->>'status','approved');
    if rdo_status='approved' and target.bid_role <> 'GL' then
      update public.rdo_lines set status='open',assigned_bidder_id=null,assigned_initials=null,updated_at=now()
        where bid_year_id=year_id and assigned_bidder_id=target.id and id<>line_row.id;
      update public.rdo_lines set status='taken',assigned_bidder_id=target.id,assigned_initials=target.initials,
        fatigue_group=group_name,flex=(line_change->>'flex')::boolean,aws=(line_change->>'aws')::boolean,
        mid=line_change->>'mid',updated_at=now() where id=line_row.id;
      perform public.refresh_bidder_holiday_in_lieu(year_id,target.id);
    end if;
    entry := jsonb_build_object('line',line_row.line_code,'rdo_line_code',line_row.line_code,'fatigueGroup',group_name,
      'fatigue_group',group_name,'flex',(line_change->>'flex')::boolean,'aws',(line_change->>'aws')::boolean,'mid',line_change->>'mid','bidAs',target.bid_role);
    if rdo_id is null then
      insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,submission_type,status,rdo_line_id,payload,submitted_at,reviewed_at,reviewed_by)
      values(year_id,target.area_id,target.id,1,'rdo','approved',line_row.id,entry,now(),now(),actor_id) returning id into rdo_id;
    else
      update public.intake_submissions set rdo_line_id=line_row.id,payload=(payload-'summary')||entry,updated_at=now()
        where id=rdo_id;
    end if;
  elsif before_state->'rdo' <> 'null'::jsonb or before_state->'assignment' <> 'null'::jsonb then
    raise exception 'Select an RDO line; an existing RDO bid cannot be removed here.';
  end if;

  bucket := case when target.bid_role in ('R-DEV','D-DEV','DEV','TMCIT') then 'dev' else 'cpc' end;
  -- Lock the whole bidding-year inventory in date order, matching ordinary submission locks.
  for d in select generate_series(make_date(requested_bid_year,1,10)::timestamp,make_date(requested_bid_year+1,1,8)::timestamp,interval '1 day')::date loop
    perform pg_advisory_xact_lock(hashtextextended(year_id::text||':'||target.area_id::text||':'||bucket||':'||d::text,0));
  end loop;
  -- Stage the entire final set, allowing valid swaps between two existing ranges.
  delete from public.leave_slots where (slot_code like 'OVERRIDE-%' or slot_code like 'OVR-%') and source_leave_request_id in
    (select id from public.leave_requests where bid_year_id=year_id and bidder_id=target.id and status in ('pending','approved'));
  update public.leave_slots set bidder_id=null,slot_initials=null,status='open',source_leave_request_id=null,updated_at=now()
    where source_leave_request_id in (select id from public.leave_requests where bid_year_id=year_id and bidder_id=target.id and status in ('pending','approved'));
  update public.leave_requests set status='draft' where bid_year_id=year_id and bidder_id=target.id and status in ('pending','approved');
  delete from public.leave_request_dates where leave_request_id in (
    select (value->>'id')::uuid from jsonb_array_elements(before_state->'leave') where value->>'status' in ('pending','approved'));
  delete from public.leave_request_week_buckets where leave_request_id in (
    select (value->>'id')::uuid from jsonb_array_elements(before_state->'leave') where value->>'status' in ('pending','approved'));
  for entry in select value from jsonb_array_elements(changes->'leave') loop
    select value into prior from jsonb_array_elements(before_state->'leave') where value->>'id'=entry->>'id';
    if prior->>'status' not in ('pending','approved')
      and (entry->>'start_date') is not distinct from (prior->>'requested_start_date')
      and (entry->>'end_date') is not distinct from (prior->>'requested_end_date') then continue; end if;
    start_day := (entry->>'start_date')::date; end_day := (entry->>'end_date')::date;
    if start_day is null or end_day is null or end_day<start_day then raise exception 'Choose a complete, valid date range for Round %.',prior->>'round_number'; end if;
    update public.leave_requests set requested_start_date=start_day,requested_end_date=end_day,
      status=prior->>'status',updated_at=now() where id=(entry->>'id')::uuid;
    perform private.replace_bidder_editor_leave_dates((entry->>'id')::uuid,start_day,end_day,false,line_row.id);
    update public.intake_submissions set payload=(payload-'summary')||jsonb_build_object('start_date',start_day,'end_date',end_day),updated_at=now()
      where leave_request_id=(entry->>'id')::uuid;
  end loop;
  -- Charge totals must be checked again after an RDO change (including 4-10 lines).
  select case when four_ten then 10 else 8 end into day_hours from public.rdo_lines
    where bid_year_id=year_id and assigned_bidder_id=target.id and status='taken' limit 1;
  day_hours := coalesce(day_hours,case when line_row.four_ten then 10 else 8 end,8);
  for round_no in 1..5 loop
    select coalesce(sum(charged_days),0)*day_hours into used_hours from public.leave_requests
      where bid_year_id=year_id and bidder_id=target.id and status in ('pending','approved') and round_number<=round_no;
    select coalesce(sum(c.credit_days),0) into credit_days from public.leave_credit_events c
      where c.bid_year_id=year_id and c.bidder_id=target.id and c.round_number<=round_no and round_no>=4;
    if used_hours > target.leave_slot_allowance+credit_days*day_hours then
      raise exception 'Round % would use % leave hours, above the % hour allowance.',round_no,used_hours,target.leave_slot_allowance+credit_days*day_hours;
    end if;
  end loop;
  insert into public.audit_events(bid_year_id,area_id,actor_id,event_type,entity_table,entity_id,details)
    values(year_id,target.area_id,actor_id,'bidder_bids_edited','bidders',target.id,
      jsonb_build_object('before',before_state,'after',private.bidder_editor_snapshot(year_id,target.id)));
  return jsonb_build_object('valid',true,'saved',true,'snapshot',private.bidder_editor_snapshot(year_id,target.id));
end $$;
revoke all on function private.save_bidder_editor(integer,uuid,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.edit_admin_bidder(requested_bid_year integer,target_bidder_id uuid,expected_snapshot jsonb,changes jsonb,validate_only boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if validate_only is null then raise exception 'Choose validation or submission.'; end if;
  if not validate_only then
    return private.save_bidder_editor(requested_bid_year,target_bidder_id,expected_snapshot,changes);
  end if;
  begin
    result := private.save_bidder_editor(requested_bid_year,target_bidder_id,expected_snapshot,changes);
    -- A caught exception rolls back ALL writes, triggers, and audit rows in this block.
    raise exception using errcode='PZ001',message='Validation completed';
  exception
    when sqlstate 'PZ001' then return jsonb_build_object('valid',true,'saved',false);
    when others then return jsonb_build_object('valid',false,'saved',false,'errors',jsonb_build_array(SQLERRM));
  end;
end $$;
revoke all on function public.edit_admin_bidder(integer,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.edit_admin_bidder(integer,uuid,jsonb,jsonb,boolean) to authenticated;
