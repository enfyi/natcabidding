-- Round 1 uses up to two movable spans of seven consecutive calendar dates.
-- Recompute from all active bid dates so an earlier replacement may move a span.

create or replace function private.round_one_week_bucket_starts(bid_dates date[])
returns date[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  selected_date date;
  current_start date;
  starts date[] := array[]::date[];
begin
  for selected_date in
    select distinct day from unnest(coalesce(bid_dates, array[]::date[])) as days(day)
    where day is not null order by day
  loop
    if current_start is null or selected_date > current_start + 6 then
      current_start := selected_date;
      starts := array_append(starts, current_start);
    end if;
  end loop;
  return starts;
end;
$function$;

create or replace function private.rebuild_round_one_week_buckets(
  target_bid_year_id uuid,
  target_bidder_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  starts date[];
begin
  select private.round_one_week_bucket_starts(array_agg(request_date.leave_date))
  into starts
  from public.leave_request_dates request_date
  join public.leave_requests request on request.id = request_date.leave_request_id
  where request.bid_year_id = target_bid_year_id
    and request.bidder_id = target_bidder_id
    and request.round_number = 1
    and request.status in ('pending', 'approved');

  if cardinality(starts) > 2 then
    raise exception 'Round 1 can include at most two seven-day bid weeks.';
  end if;

  delete from public.leave_request_week_buckets bucket
  using public.leave_requests request
  where bucket.leave_request_id = request.id
    and request.bid_year_id = target_bid_year_id
    and request.bidder_id = target_bidder_id
    and request.round_number = 1
    and request.status in ('pending', 'approved');

  insert into public.leave_request_week_buckets (
    leave_request_id, bucket_start_date, bucket_end_date
  )
  select distinct request.id, bucket_start, bucket_start + 6
  from public.leave_requests request
  join public.leave_request_dates request_date on request_date.leave_request_id = request.id
  cross join unnest(starts) as weeks(bucket_start)
  where request.bid_year_id = target_bid_year_id
    and request.bidder_id = target_bidder_id
    and request.round_number = 1
    and request.status in ('pending', 'approved')
    and request_date.leave_date between bucket_start and bucket_start + 6;

  update public.leave_request_dates request_date
  set week_bucket_id = bucket.id
  from public.leave_request_week_buckets bucket
  join public.leave_requests request on request.id = bucket.leave_request_id
  where request_date.leave_request_id = request.id
    and request_date.leave_date between bucket.bucket_start_date and bucket.bucket_end_date
    and request.bid_year_id = target_bid_year_id
    and request.bidder_id = target_bidder_id
    and request.round_number = 1
    and request.status in ('pending', 'approved');
end;
$function$;

revoke all on function private.round_one_week_bucket_starts(date[]) from public, anon, authenticated;
revoke all on function private.rebuild_round_one_week_buckets(uuid,uuid) from public, anon, authenticated;

create or replace function private.rebuild_round_one_buckets_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.round_number = 1
     and (old.status in ('pending', 'approved')) is distinct from
         (new.status in ('pending', 'approved')) then
    perform private.rebuild_round_one_week_buckets(new.bid_year_id, new.bidder_id);
  end if;
  return new;
end;
$function$;

revoke all on function private.rebuild_round_one_buckets_after_status_change() from public, anon, authenticated;
drop trigger if exists rebuild_round_one_buckets_after_status_change on public.leave_requests;
create trigger rebuild_round_one_buckets_after_status_change
after update of status on public.leave_requests
for each row execute function private.rebuild_round_one_buckets_after_status_change();

do $function$
declare
  bidder_round record;
begin
  for bidder_round in
    select distinct bid_year_id, bidder_id
    from public.leave_requests
    where round_number = 1 and status in ('pending', 'approved')
  loop
    perform private.rebuild_round_one_week_buckets(
      bidder_round.bid_year_id, bidder_round.bidder_id
    );
  end loop;
end;
$function$;

-- Current implementation from holiday_leave_round_rules.sql
create or replace function private.submit_leave_bid_batch_unchecked(
  requested_bid_year integer,
  requested_items jsonb,
  target_initials text default null,
  target_area_name text default null,
  manual_entry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  target public.bidders%rowtype;
  year_row public.bid_years%rowtype;
  item jsonb;
  request_id uuid;
  submission_id uuid;
  start_date date;
  end_date date;
  leave_date date;
  round_no integer;
  batch_round integer;
  priority_no integer;
  item_charged integer;
  batch_charged integer := 0;
  committed_round_charged integer;
  enforce_bid_windows boolean := true;
  configured_test_round integer;
  all_dates date[];
  bucket_starts date[] := array[]::date[];
  bucket_start date;
  is_rdo boolean;
  is_holiday boolean;
  is_in_lieu boolean;
  effective_rdo_line_id uuid;
  result_ids jsonb := '[]'::jsonb;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email') and active
  for update;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;

  select * into strict year_row from public.bid_years where bid_year = requested_bid_year;
  select coalesce(settings.enforce_bid_windows, true), settings.test_bid_round
  into enforce_bid_windows, configured_test_round
  from public.bid_year_settings settings
  where settings.bid_year_id = year_row.id;
  enforce_bid_windows := coalesce(enforce_bid_windows, true);
  if requested_items is null or jsonb_typeof(requested_items) <> 'array' or jsonb_array_length(requested_items) = 0 then
    raise exception 'At least one leave request is required.';
  end if;

  if target_initials is null then target := actor;
  else
    if not manual_entry or actor.role not in ('admin', 'intake') then
      raise exception 'Manual entry requires bidding reviewer access.';
    end if;
    select b.* into strict target from public.bidders b
    left join public.areas a on a.id = b.area_id
    where upper(b.initials) = upper(target_initials) and b.active
      and (target_area_name is null or a.name = target_area_name)
    order by case when b.area_id = actor.area_id then 0 else 1 end, b.id limit 1 for update of b;
  end if;

  -- Validate the inexpensive invariants before expanding ranges into individual
  -- dates so malformed input cannot force an unbounded generate_series call.
  for item in select * from jsonb_array_elements(requested_items) loop
    start_date := (item->>'start_date')::date;
    end_date := (item->>'end_date')::date;
    round_no := (item->>'round')::integer;
    if start_date is null or end_date is null or end_date < start_date then raise exception 'Invalid leave date range.'; end if;
    if start_date < make_date(year_row.bid_year, 1, 10)
       or end_date > make_date(year_row.bid_year + 1, 1, 8) then
      raise exception 'Leave must stay between Jan 10, % and Jan 8, %.', year_row.bid_year, year_row.bid_year + 1;
    end if;
    if round_no is null or round_no not between 1 and 4 then raise exception 'Round must be between 1 and 4.'; end if;
    if batch_round is null then batch_round := round_no;
    elsif batch_round <> round_no then raise exception 'A leave batch must use one round.';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(requested_items) with ordinality first_item(item, item_order)
    join jsonb_array_elements(requested_items) with ordinality second_item(item, item_order)
      on first_item.item_order < second_item.item_order
    where daterange((first_item.item->>'start_date')::date, (first_item.item->>'end_date')::date, '[]')
      && daterange((second_item.item->>'start_date')::date, (second_item.item->>'end_date')::date, '[]')
  ) then
    raise exception 'A leave batch cannot contain overlapping date ranges.';
  end if;

  if exists (
    select 1
    from public.leave_requests lr
    cross join jsonb_array_elements(requested_items) requested(item)
    where lr.bid_year_id = year_row.id and lr.bidder_id = target.id
      and lr.status in ('pending', 'approved')
      and daterange(lr.requested_start_date, lr.requested_end_date, '[]')
        && daterange((requested.item->>'start_date')::date, (requested.item->>'end_date')::date, '[]')
  ) then
    raise exception 'Leave request overlaps an existing pending or approved request.';
  end if;

  select array_agg(distinct gs::date order by gs::date) into all_dates
  from jsonb_array_elements(requested_items) j
  cross join lateral generate_series((j->>'start_date')::date, (j->>'end_date')::date, interval '1 day') gs;

  select rl.id into effective_rdo_line_id
  from public.rdo_lines rl
  where rl.bid_year_id = year_row.id and rl.assigned_bidder_id = target.id and rl.status = 'taken'
  order by rl.updated_at desc, rl.id limit 1;
  if effective_rdo_line_id is null then
    select submission.rdo_line_id into effective_rdo_line_id
    from public.intake_submissions submission
    where submission.bid_year_id = year_row.id and submission.bidder_id = target.id
      and submission.submission_type = 'rdo' and submission.status in ('pending', 'approved')
    order by submission.reviewed_at desc nulls last,
      submission.submitted_at desc nulls last, submission.created_at desc
    limit 1;
  end if;

  for item in select * from jsonb_array_elements(requested_items) loop
    start_date := (item->>'start_date')::date;
    end_date := (item->>'end_date')::date;
    round_no := (item->>'round')::integer;
    if start_date is null or end_date is null or end_date < start_date then raise exception 'Invalid leave date range.'; end if;
    if round_no is null or round_no not between 1 and 4 then raise exception 'Round must be between 1 and 4.'; end if;
    if batch_round is null then batch_round := round_no;
    elsif batch_round <> round_no then raise exception 'A leave batch must use one round.';
    end if;

    item_charged := 0;
    for leave_date in select gs::date from generate_series(start_date, end_date, interval '1 day') gs loop
      select exists (
        select 1 from public.rdo_lines rl join public.rdo_line_days d on d.rdo_line_id = rl.id
        where rl.id = effective_rdo_line_id
          and d.is_rdo and d.weekday = extract(dow from leave_date)::smallint
      ) into is_rdo;
      select exists (select 1 from public.holidays h where h.bid_year_id = year_row.id and h.holiday_date = leave_date) into is_holiday;
      select exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id = year_row.id and h.bidder_id = target.id and h.in_lieu_date = leave_date) into is_in_lieu;
      if round_no > 1 and is_rdo then raise exception 'Leave cannot include the bidder''s RDO after Round 1 (%).', leave_date; end if;
      if not (round_no = 1 and is_rdo)
         and (round_no <= 3 or (not is_holiday and not is_in_lieu)) then
        item_charged := item_charged + 1;
      end if;
    end loop;
    batch_charged := batch_charged + item_charged;
  end loop;

  if not manual_entry and enforce_bid_windows and not exists (
    select 1 from public.bid_windows bw where bw.bid_year_id = year_row.id and bw.bidder_id = target.id
      and bw.round_number = batch_round and now() >= bw.opens_at and now() < bw.closes_at
  ) then raise exception 'Your bidding window is not open.'; end if;
  if not manual_entry and not enforce_bid_windows
     and configured_test_round is not null and batch_round <> configured_test_round then
    raise exception 'Testing mode is currently set to Round %.', configured_test_round;
  end if;

  if batch_round = 1 then
    select private.round_one_week_bucket_starts(
      coalesce(array_agg(request_date.leave_date), array[]::date[]) || all_dates
    )
    into bucket_starts
    from public.leave_request_dates request_date
    join public.leave_requests request on request.id = request_date.leave_request_id
    where request.bid_year_id = year_row.id
      and request.bidder_id = target.id
      and request.round_number = 1
      and request.status in ('pending', 'approved');

    if cardinality(bucket_starts) > 2 then
      raise exception 'Round 1 can include at most two seven-day bid weeks.';
    end if;
  else
    select coalesce(sum(charged_days), 0) into committed_round_charged
    from public.leave_requests
    where bid_year_id = year_row.id and bidder_id = target.id
      and round_number = batch_round and status in ('pending', 'approved');
    if batch_round in (2, 3) and committed_round_charged + batch_charged > 10 then
      raise exception 'Rounds 2 and 3 can include at most 10 charged days total.';
    elsif batch_round = 4 and committed_round_charged + batch_charged > 5 then
      raise exception 'Round 4 can include at most 5 charged days total.';
    end if;
  end if;

  -- The public preflight owns the per-bidder leave-hour allowance. This private
  -- submitter must not reinterpret leave_slot_allowance as a request count or
  -- apply a separate bid-year day cap after preflight has accepted the batch.

  select coalesce(max(priority), 0) into priority_no from public.leave_requests
  where bid_year_id = year_row.id and bidder_id = target.id and round_number = batch_round;

  for item in select * from jsonb_array_elements(requested_items) loop
    start_date := (item->>'start_date')::date;
    end_date := (item->>'end_date')::date;
    round_no := (item->>'round')::integer;
    item_charged := 0;
    priority_no := priority_no + 1;

    for leave_date in select gs::date from generate_series(start_date, end_date, interval '1 day') gs loop
      select exists (
        select 1 from public.rdo_lines rl join public.rdo_line_days d on d.rdo_line_id = rl.id
        where rl.id = effective_rdo_line_id
          and d.is_rdo and d.weekday = extract(dow from leave_date)::smallint
      ) into is_rdo;
      select exists (select 1 from public.holidays h where h.bid_year_id = year_row.id and h.holiday_date = leave_date) into is_holiday;
      select exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id = year_row.id and h.bidder_id = target.id and h.in_lieu_date = leave_date) into is_in_lieu;
      if not (round_no = 1 and is_rdo)
         and (round_no <= 3 or (not is_holiday and not is_in_lieu)) then
        item_charged := item_charged + 1;
      end if;
    end loop;

    insert into public.leave_requests (
      bid_year_id, bidder_id, round_number, priority, status,
      requested_start_date, requested_end_date, charged_days, notes, submitted_at
    ) values (
      year_row.id, target.id, round_no, priority_no, 'pending',
      start_date, end_date, item_charged, nullif(item->>'notes', ''), now()
    ) returning id into request_id;

    if round_no = 1 then
      foreach bucket_start in array bucket_starts loop
        if daterange(start_date, end_date, '[]') && daterange(bucket_start, bucket_start + 6, '[]') then
          insert into public.leave_request_week_buckets (leave_request_id, bucket_start_date, bucket_end_date)
          values (request_id, bucket_start, bucket_start + 6);
        end if;
      end loop;
    end if;

    for leave_date in select gs::date from generate_series(start_date, end_date, interval '1 day') gs loop
      select exists (
        select 1 from public.rdo_lines rl join public.rdo_line_days d on d.rdo_line_id = rl.id
        where rl.id = effective_rdo_line_id
          and d.is_rdo and d.weekday = extract(dow from leave_date)::smallint
      ) into is_rdo;
      select exists (select 1 from public.holidays h where h.bid_year_id = year_row.id and h.holiday_date = leave_date) into is_holiday;
      select exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id = year_row.id and h.bidder_id = target.id and h.in_lieu_date = leave_date) into is_in_lieu;
      insert into public.leave_request_dates (leave_request_id, leave_date, charged, is_rdo, is_holiday, is_holiday_in_lieu)
      values (request_id, leave_date,
        not (round_no = 1 and is_rdo)
          and (round_no <= 3 or (not is_holiday and not is_in_lieu)),
        is_rdo, is_holiday, is_in_lieu);
    end loop;

    insert into public.intake_submissions (
      bid_year_id, area_id, bidder_id, round_number, leave_request_id,
      submission_type, status, payload, submitted_at
    ) values (
      year_row.id, target.area_id, target.id, round_no, request_id, 'leave', 'pending',
      jsonb_build_object('range', start_date || ' - ' || end_date, 'days', item_charged,
        'startDate', start_date, 'endDate', end_date, 'bidAs', target.bid_role,
        'notes', nullif(item->>'notes', '')), now()
    ) returning id into submission_id;

    result_ids := result_ids || jsonb_build_array(submission_id);
  end loop;

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, details)
  values (year_row.id, target.area_id, actor.id, 'leave_batch_submitted', 'intake_submissions',
    jsonb_build_object('target_bidder_id', target.id, 'round', batch_round, 'charged_days', batch_charged, 'submission_ids', result_ids));

  if batch_round = 1 then
    perform private.rebuild_round_one_week_buckets(year_row.id, target.id);
  end if;

  return jsonb_build_object('submission_ids', result_ids, 'round', batch_round, 'charged_days', batch_charged);
end
$$;

-- Current implementation from admin_leave_request_edit.sql
do $upgrade$
begin
  if to_regprocedure('private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)') is not null then
    execute $definition$
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
  check_round integer;
  leave_hours_per_day integer;
  used_hours integer;
  credit_days integer;
  manual_credit_days integer;
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

  if target.bid_role in ('ADM', 'NB') then
    raise exception 'This profile cannot be assigned leave.';
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
  where (request_row.round_number <= 3 or (not exists (
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
    )))
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
    select cardinality(private.round_one_week_bucket_starts(array_agg(generated_date::date)))
    into replacement_week_count
    from pg_catalog.generate_series(
      requested_start_date::timestamp,
      requested_end_date::timestamp,
      interval '1 day'
    ) generated_date;

    select cardinality(private.round_one_week_bucket_starts(array_agg(week_dates.leave_date)))
    into other_round_usage
    from (
      select request_date.leave_date
      from public.leave_request_dates request_date
      join public.leave_requests other_request on other_request.id = request_date.leave_request_id
      where other_request.bid_year_id = request_row.bid_year_id
        and other_request.bidder_id = request_row.bidder_id
        and other_request.round_number = 1
        and other_request.status in ('pending', 'approved')
        and other_request.id <> request_row.id
      union all
      select generated_date::date
      from pg_catalog.generate_series(
        requested_start_date::timestamp,
        requested_end_date::timestamp,
        interval '1 day'
      ) generated_date
    ) week_dates;

    if other_round_usage > 2 then
      raise exception 'Round 1 can include no more than 2 seven-day bid weeks.';
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
    not (request_row.round_number = 1 and rdo.is_rdo)
      and (request_row.round_number <= 3
        or (not holiday.is_holiday and not in_lieu.is_holiday_in_lieu)),
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
      and not request_date.is_holiday and not request_date.is_holiday_in_lieu
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
      and not pending_date.is_holiday and not pending_date.is_holiday_in_lieu
      and pending_bidder.area_id = target.area_id
      and pending_bidder.bid_role not in ('ADM', 'NB')
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

  select case when line.four_ten then 10 else 8 end
  into leave_hours_per_day
  from public.rdo_lines line where line.id = target_rdo_line_id;
  leave_hours_per_day := coalesce(leave_hours_per_day, 8);
  for check_round in 1..4 loop
    select coalesce(sum(request.charged_days), 0) * leave_hours_per_day
    into used_hours
    from public.leave_requests request
    where request.bid_year_id = request_row.bid_year_id
      and request.bidder_id = target.id
      and request.status in ('pending', 'approved')
      and request.round_number <= check_round;
    credit_days := 0;
    if check_round = 4 then
      select count(distinct request_date.leave_date)
      into credit_days
      from public.leave_request_dates request_date
      join public.leave_requests request on request.id = request_date.leave_request_id
      where request.bid_year_id = request_row.bid_year_id
        and request.bidder_id = target.id
        and request.round_number between 1 and 3
        and request.status in ('pending', 'approved')
        and request_date.charged
        and (request_date.is_holiday or request_date.is_holiday_in_lieu);
      select coalesce(sum(event.credit_days), 0)
      into manual_credit_days
      from public.leave_credit_events event
      where event.bid_year_id = request_row.bid_year_id
        and event.bidder_id = target.id
        and event.round_number <= check_round
        and event.source = 'manual_adjustment';
      credit_days := credit_days + manual_credit_days;
    end if;
    if used_hours > target.leave_slot_allowance + credit_days * leave_hours_per_day then
      raise exception 'Round % would use % leave hours, above the % hour allowance.',
        check_round, used_hours, target.leave_slot_allowance + credit_days * leave_hours_per_day;
    end if;
  end loop;

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

  if request_row.round_number = 1 and request_row.status in ('pending', 'approved') then
    perform private.rebuild_round_one_week_buckets(request_row.bid_year_id, request_row.bidder_id);
  end if;

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
$definition$;
  end if;
end;
$upgrade$;

-- Current implementation from admin_bidder_editor.sql
do $upgrade$
begin
  if to_regprocedure('private.replace_bidder_editor_leave_dates(uuid,date,date,boolean,uuid)') is not null then
    execute $definition$
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

  if target.bid_role in ('ADM', 'NB') then
    raise exception 'This profile cannot be assigned leave.';
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
  where (request_row.round_number <= 3 or (not exists (
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
    )))
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
    select cardinality(private.round_one_week_bucket_starts(array_agg(generated_date::date)))
    into replacement_week_count
    from pg_catalog.generate_series(
      requested_edit_start_date::timestamp,
      requested_edit_end_date::timestamp,
      interval '1 day'
    ) generated_date;

    select cardinality(private.round_one_week_bucket_starts(array_agg(week_dates.leave_date)))
    into other_round_usage
    from (
      select request_date.leave_date
      from public.leave_request_dates request_date
      join public.leave_requests other_request on other_request.id = request_date.leave_request_id
      where other_request.bid_year_id = request_row.bid_year_id
        and other_request.bidder_id = request_row.bidder_id
        and other_request.round_number = 1
        and other_request.status in ('pending', 'approved')
        and other_request.id <> request_row.id
      union all
      select generated_date::date
      from pg_catalog.generate_series(
        requested_edit_start_date::timestamp,
        requested_edit_end_date::timestamp,
        interval '1 day'
      ) generated_date
    ) week_dates;

    if request_row.status in ('pending','approved') and other_round_usage > 2 then
      raise exception 'Round 1 can include no more than 2 seven-day bid weeks.';
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
    not (request_row.round_number = 1 and rdo.is_rdo)
      and (request_row.round_number <= 3
        or (not holiday.is_holiday and not in_lieu.is_holiday_in_lieu)),
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
      and not request_date.is_holiday and not request_date.is_holiday_in_lieu
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
      and not pending_date.is_holiday and not pending_date.is_holiday_in_lieu
      and pending_bidder.area_id = target.area_id
      and pending_bidder.bid_role not in ('ADM', 'NB')
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

  if request_row.round_number = 1 and request_row.status in ('pending', 'approved') then
    perform private.rebuild_round_one_week_buckets(request_row.bid_year_id, request_row.bidder_id);
  end if;

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
$definition$;
  end if;
end;
$upgrade$;
