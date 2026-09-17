-- Rounds 1-3 charge bid holidays and holiday-in-lieu dates against the
-- bidder's leave allowance and round day limit. Round 4 restores one day of
-- allowance per distinct charged holiday/in-lieu date from Rounds 1-3.
-- Holiday dates never reserve daily CPC/DEV leave slots.
-- Pending RDO requests create provisional in-lieu dates for leave validation.
-- Apply after resolve_bidding_sql_conflicts.sql and leave_submission_preflight.sql.
begin;

do $$
begin
  if to_regprocedure('private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)') is null then
    raise exception 'Install the leave preflight and bidding consistency upgrade first.';
  end if;
end
$$;

create or replace function public.refresh_bidder_holiday_in_lieu(
  target_bid_year_id uuid,
  target_bidder_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_id uuid;
  holiday_row record;
  first_rdo smallint;
  direction integer;
  candidate date;
begin
  delete from public.holiday_in_lieu_days
  where bid_year_id = target_bid_year_id and bidder_id = target_bidder_id;

  select rl.id into line_id
  from public.rdo_lines rl
  where rl.bid_year_id = target_bid_year_id
    and rl.assigned_bidder_id = target_bidder_id
    and rl.status = 'taken'
  limit 1;

  if line_id is null then
    select submission.rdo_line_id into line_id
    from public.intake_submissions submission
    where submission.bid_year_id = target_bid_year_id
      and submission.bidder_id = target_bidder_id
      and submission.submission_type = 'rdo'
      and submission.status = 'pending'
    order by submission.submitted_at desc nulls last, submission.created_at desc
    limit 1;
  end if;

  if line_id is not null then
    select min(rld.weekday) into first_rdo
    from public.rdo_line_days rld
    where rld.rdo_line_id = line_id and rld.is_rdo;

    for holiday_row in
      select h.*
      from public.holidays h
      where h.bid_year_id = target_bid_year_id
      order by h.holiday_date, h.id
    loop
      if not exists (
        select 1 from public.rdo_line_days rld
        where rld.rdo_line_id = line_id
          and rld.is_rdo
          and rld.weekday = extract(dow from holiday_row.holiday_date)::smallint
      ) then
        continue;
      end if;

      direction := case when extract(dow from holiday_row.holiday_date)::smallint = first_rdo then 1 else -1 end;
      candidate := holiday_row.holiday_date + direction;

      while exists (
        select 1 from public.rdo_line_days rld
        where rld.rdo_line_id = line_id and rld.is_rdo
          and rld.weekday = extract(dow from candidate)::smallint
      ) or exists (
        select 1 from public.holidays h
        where h.bid_year_id = target_bid_year_id and h.holiday_date = candidate
      ) or exists (
        select 1 from public.holiday_in_lieu_days hil
        where hil.bid_year_id = target_bid_year_id
          and hil.bidder_id = target_bidder_id
          and hil.in_lieu_date = candidate
      ) loop
        candidate := candidate + direction;
      end loop;

      insert into public.holiday_in_lieu_days (
        bid_year_id, bidder_id, holiday_id, in_lieu_date, source_rdo_line_id
      ) values (
        target_bid_year_id, target_bidder_id, holiday_row.id, candidate, line_id
      );
    end loop;
  end if;

  update public.leave_request_dates request_date
  set is_holiday_in_lieu = exists (
        select 1 from public.holiday_in_lieu_days in_lieu
        where in_lieu.bid_year_id = target_bid_year_id
          and in_lieu.bidder_id = target_bidder_id
          and in_lieu.in_lieu_date = request_date.leave_date
      ),
      charged = not (request.round_number = 1 and request_date.is_rdo)
        and (request.round_number <= 3 or (
          not request_date.is_holiday
          and not exists (
            select 1 from public.holiday_in_lieu_days in_lieu
            where in_lieu.bid_year_id = target_bid_year_id
              and in_lieu.bidder_id = target_bidder_id
              and in_lieu.in_lieu_date = request_date.leave_date
          )
        ))
  from public.leave_requests request
  where request_date.leave_request_id = request.id
    and request.bid_year_id = target_bid_year_id
    and request.bidder_id = target_bidder_id
    and request.status = 'pending';

  update public.leave_requests request
  set charged_days = (select count(*)::integer from public.leave_request_dates request_date
                      where request_date.leave_request_id = request.id and request_date.charged),
      updated_at = now()
  where request.bid_year_id = target_bid_year_id
    and request.bidder_id = target_bidder_id
    and request.status = 'pending';
end
$$;

create or replace function public.submit_rdo_bid(
  requested_bid_year integer,
  requested_line_code text,
  requested_fatigue_group text,
  requested_flex boolean,
  requested_aws boolean,
  requested_mid text,
  requested_round integer default null,
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
  line_row public.rdo_lines%rowtype;
  resolved_round integer;
  submission_id uuid;
  area_max integer;
  crew_max integer;
  area_used integer;
  crew_used integer;
  enforce_bid_windows boolean := true;
  configured_test_round integer;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
    and active
  for update;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;

  select * into strict year_row from public.bid_years where bid_year = requested_bid_year;

  select coalesce(settings.enforce_bid_windows, true), settings.test_bid_round
  into enforce_bid_windows, configured_test_round
  from public.bid_year_settings settings
  where settings.bid_year_id = year_row.id;
  enforce_bid_windows := coalesce(enforce_bid_windows, true);

  if target_initials is null then
    target := actor;
  else
    if not manual_entry or actor.role not in ('admin', 'intake') then
      raise exception 'Manual entry requires bidding reviewer access.';
    end if;
    select b.* into strict target from public.bidders b
    left join public.areas a on a.id = b.area_id
    where upper(b.initials) = upper(target_initials) and b.active
      and (target_area_name is null or a.name = target_area_name)
    order by case when b.area_id = actor.area_id then 0 else 1 end, b.id
    limit 1
    for update of b;
  end if;

  if manual_entry then
    resolved_round := requested_round;
    if resolved_round not between 1 and 4 then raise exception 'Round must be between 1 and 4.'; end if;
  elsif not enforce_bid_windows then
    resolved_round := coalesce(configured_test_round, requested_round);
    if resolved_round not between 1 and 4 then raise exception 'Round must be between 1 and 4.'; end if;
    if configured_test_round is not null and requested_round is distinct from configured_test_round then
      raise exception 'Testing mode is currently set to Round %.', configured_test_round;
    end if;
  else
    select bw.round_number into resolved_round
    from public.bid_windows bw
    where bw.bid_year_id = year_row.id and bw.bidder_id = target.id
      and now() >= bw.opens_at and now() < bw.closes_at
    order by bw.round_number
    limit 1;
    if resolved_round is null then raise exception 'Your bidding window is not open.'; end if;
  end if;

  select * into strict line_row
  from public.rdo_lines rl
  where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
    and rl.line_code = requested_line_code
  for update;

  if target.bid_role <> 'GL' and line_row.status <> 'open'
     and line_row.assigned_bidder_id is distinct from target.id then
    raise exception 'RDO line % is already assigned.', requested_line_code;
  end if;

  if line_row.line_type = 'CPC' and target.bid_role <> 'GL' then
    if requested_fatigue_group not in ('A', 'B', 'C') then
      raise exception 'Choose fatigue group A, B, or C.';
    end if;

    select greatest(1, floor(count(*)::numeric / 3)::integer) into area_max
    from public.rdo_lines rl
    where rl.bid_year_id = year_row.id and rl.area_id = target.area_id and rl.line_type = 'CPC';
    select greatest(1, floor(count(*)::numeric / 3)::integer) into crew_max
    from public.rdo_lines rl
    where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
      and rl.line_type = 'CPC' and rl.pattern = line_row.pattern;
    select count(*) into area_used from public.rdo_lines rl
    where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
      and rl.line_type = 'CPC' and rl.status = 'taken'
      and rl.fatigue_group = requested_fatigue_group
      and rl.assigned_bidder_id is distinct from target.id;
    select count(*) into crew_used from public.rdo_lines rl
    where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
      and rl.line_type = 'CPC' and rl.pattern = line_row.pattern and rl.status = 'taken'
      and rl.fatigue_group = requested_fatigue_group
      and rl.assigned_bidder_id is distinct from target.id;
    if area_used >= area_max or crew_used >= crew_max then
      raise exception 'Fatigue group % is full for this area or crew.', requested_fatigue_group;
    end if;
  end if;

  select s.id into submission_id
  from public.intake_submissions s
  where s.bid_year_id = year_row.id and s.bidder_id = target.id
    and s.round_number = resolved_round and s.submission_type = 'rdo' and s.status = 'pending'
  for update;

  if submission_id is null then
    insert into public.intake_submissions (
      bid_year_id, area_id, bidder_id, round_number, rdo_line_id,
      submission_type, status, payload, submitted_at
    ) values (
      year_row.id, target.area_id, target.id, resolved_round, line_row.id,
      'rdo', 'pending', jsonb_build_object(
        'line', line_row.line_code, 'fatigueGroup', requested_fatigue_group,
        'flex', requested_flex, 'aws', requested_aws, 'mid', requested_mid,
        'bidAs', target.bid_role
      ), now()
    ) returning id into submission_id;
  else
    update public.intake_submissions
    set rdo_line_id = line_row.id,
        payload = jsonb_build_object(
          'line', line_row.line_code, 'fatigueGroup', requested_fatigue_group,
          'flex', requested_flex, 'aws', requested_aws, 'mid', requested_mid,
          'bidAs', target.bid_role
        ), submitted_at = now(), updated_at = now()
    where id = submission_id;
  end if;

  perform public.refresh_bidder_holiday_in_lieu(year_row.id, target.id);

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  values (year_row.id, target.area_id, actor.id, 'rdo_bid_submitted', 'intake_submissions', submission_id,
    jsonb_build_object('target_bidder_id', target.id, 'line_code', line_row.line_code, 'round', resolved_round));

  return jsonb_build_object('submission_id', submission_id, 'round', resolved_round);
end
$$;

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

create or replace function public.submit_leave_bid_batch(
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
as $function$
declare
  actor public.bidders%rowtype;
  target public.bidders%rowtype;
  year_row public.bid_years%rowtype;
  item jsonb;
  start_date date;
  end_date date;
  leave_date date;
  round_no integer;
  batch_round integer;
  target_bucket text;
  target_area text;
  target_rdo_line_id uuid;
  submitted_rdo_line_id uuid;
  submitted_rdo_line_code text;
  rdo_request_line_code text;
  open_bid_window_id uuid;
  enforce_bid_windows boolean := true;
  configured_test_round integer;
  requested_charged_days integer := 0;
  existing_charged_days integer := 0;
  leave_hours_per_day integer := 8;
  available_credit_days integer := 0;
  maximum_leave_hours integer := 0;
  projected_leave_hours integer := 0;
  existing_round_usage integer := 0;
  round_leave_limit integer := 0;
  capacity_conflict_dates date[];
  duplicate_conflict_dates date[];
  conflict_date_labels text;
  error_messages text[] := array[]::text[];
begin
  select b.*
  into actor
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.active
  for update;

  if actor.id is null then
    raise exception 'Authenticated bidder profile required.';
  end if;

  select bys.*
  into strict year_row
  from public.bid_years bys
  where bys.bid_year = requested_bid_year;

  select coalesce(settings.enforce_bid_windows, true), settings.test_bid_round
  into enforce_bid_windows, configured_test_round
  from public.bid_year_settings settings
  where settings.bid_year_id = year_row.id;

  enforce_bid_windows := coalesce(enforce_bid_windows, true);

  if requested_items is null
     or jsonb_typeof(requested_items) <> 'array'
     or jsonb_array_length(requested_items) = 0 then
    raise exception 'At least one leave request is required.';
  end if;

  if target_initials is null then
    target := actor;
  else
    if not manual_entry or actor.role not in ('admin', 'intake') then
      raise exception 'Manual entry requires bidding reviewer access.';
    end if;

    select b.*
    into strict target
    from public.bidders b
    left join public.areas a on a.id = b.area_id
    where upper(b.initials) = upper(target_initials)
      and b.active
      and (target_area_name is null or a.name = target_area_name)
    order by case when b.area_id = actor.area_id then 0 else 1 end, b.id
    limit 1
    for update of b;
  end if;

  if target.area_id is null then
    raise exception 'The bidder must be assigned to an area before leave can be submitted.';
  end if;

  if target.bid_role in ('ADM', 'NB') then
    raise exception 'This profile is not eligible to submit leave bids.';
  end if;

  select a.name
  into strict target_area
  from public.areas a
  where a.id = target.area_id;

  target_bucket := case
    when target.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
    else 'cpc'
  end;

  -- Validate bounded, parseable input before expanding ranges.
  for item in
    select value from jsonb_array_elements(requested_items)
  loop
    if coalesce(item ->> 'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(item ->> 'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(item ->> 'round', '') !~ '^[0-9]+$' then
      raise exception 'Each leave request requires valid start_date, end_date, and round values.';
    end if;

    begin
      start_date := (item ->> 'start_date')::date;
      end_date := (item ->> 'end_date')::date;
      round_no := (item ->> 'round')::integer;
    exception
      when others then
        raise exception 'Each leave request requires valid start_date, end_date, and round values.';
    end;

    if end_date < start_date then
      raise exception 'Invalid leave date range.';
    end if;
    if start_date < make_date(year_row.bid_year, 1, 10)
       or end_date > make_date(year_row.bid_year + 1, 1, 8) then
      raise exception 'Leave must stay between Jan 10, % and Jan 8, %.',
        year_row.bid_year, year_row.bid_year + 1;
    end if;
    if round_no not between 1 and 4 then
      raise exception 'Round must be between 1 and 4.';
    end if;

    if batch_round is null then
      batch_round := round_no;
    elsif batch_round <> round_no then
      raise exception 'A leave batch must use one round.';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(requested_items) with ordinality first_item(item, item_order)
    join jsonb_array_elements(requested_items) with ordinality second_item(item, item_order)
      on first_item.item_order < second_item.item_order
    where daterange(
      (first_item.item ->> 'start_date')::date,
      (first_item.item ->> 'end_date')::date,
      '[]'
    ) && daterange(
      (second_item.item ->> 'start_date')::date,
      (second_item.item ->> 'end_date')::date,
      '[]'
    )
  ) then
    raise exception 'Your batch could not be submitted for review because it contains overlapping date ranges.';
  end if;

  if not manual_entry
     and not enforce_bid_windows
     and configured_test_round is not null
     and batch_round <> configured_test_round then
    error_messages := array_append(
      error_messages,
      format('Testing mode is currently set to Round %s.', configured_test_round)
    );
  end if;

  if not manual_entry and enforce_bid_windows then
    select bw.id
    into open_bid_window_id
    from public.bid_windows bw
    where bw.bid_year_id = year_row.id
      and bw.bidder_id = target.id
      and bw.round_number = batch_round
      and now() >= bw.opens_at
      and now() < bw.closes_at
    order by bw.opens_at desc
    limit 1;

    if open_bid_window_id is null then
      error_messages := array_append(
        error_messages,
        format('Leave can only be submitted during your allotted Round %s bid window.', batch_round)
      );
    end if;
  end if;

  select nullif(requested.item ->> 'rdo_line_code', '')
  into submitted_rdo_line_code
  from jsonb_array_elements(requested_items) requested(item)
  where nullif(requested.item ->> 'rdo_line_code', '') is not null
  limit 1;

  if submitted_rdo_line_code is not null
     and exists (
       select 1
       from jsonb_array_elements(requested_items) requested(item)
       where nullif(requested.item ->> 'rdo_line_code', '') is not null
         and nullif(requested.item ->> 'rdo_line_code', '') <> submitted_rdo_line_code
     ) then
    raise exception 'A leave batch must use one RDO line.';
  end if;

  -- A bidder must have requested an RDO line before leave can be submitted,
  -- but intake approval is not required yet. Approved RDO patterns are removed
  -- from charged leave by the underlying submitter and reconciliation trigger.
  select rl.id
  into target_rdo_line_id
  from public.rdo_lines rl
  where rl.bid_year_id = year_row.id
    and rl.area_id = target.area_id
    and rl.assigned_bidder_id = target.id
    and rl.status = 'taken'
  order by rl.updated_at desc, rl.id
  limit 1;

  if target_rdo_line_id is null then
    select coalesce(
      nullif(submission.payload ->> 'rdo_line_code', ''),
      nullif(submission.payload ->> 'line', '')
    )
    into rdo_request_line_code
    from public.intake_submissions submission
    where submission.bid_year_id = year_row.id
      and submission.bidder_id = target.id
      and submission.submission_type = 'rdo'
      and submission.status in ('pending', 'approved')
      and coalesce(
        nullif(submission.payload ->> 'rdo_line_code', ''),
        nullif(submission.payload ->> 'line', '')
      ) is not null
    order by submission.reviewed_at desc nulls last, submission.submitted_at desc nulls last, submission.created_at desc
    limit 1;
  end if;

  if target_rdo_line_id is null
     and submitted_rdo_line_code is not null
     and rdo_request_line_code is not null
     and submitted_rdo_line_code <> rdo_request_line_code then
    error_messages := array_append(
      error_messages,
      'Submit leave with the same RDO line that is pending intake review.'
    );
  end if;

  submitted_rdo_line_code := coalesce(submitted_rdo_line_code, rdo_request_line_code);

  if target_rdo_line_id is null and submitted_rdo_line_code is not null then
    select rl.id
    into submitted_rdo_line_id
    from public.rdo_lines rl
    where rl.bid_year_id = year_row.id
      and rl.area_id = target.area_id
      and rl.line_code = submitted_rdo_line_code
    for update;

    if submitted_rdo_line_id is null then
      error_messages := array_append(
        error_messages,
        format('RDO Line %s could not be found in %s.', submitted_rdo_line_code, target_area)
      );
    elsif exists (
      select 1
      from public.rdo_lines rl
      where rl.id = submitted_rdo_line_id
        and not (
          rl.status = 'open'
          or (rl.status = 'taken' and rl.assigned_bidder_id = target.id)
        )
    ) then
      error_messages := array_append(
        error_messages,
        format('RDO Line %s is no longer available.', submitted_rdo_line_code)
      );
    end if;
  end if;

  if target_rdo_line_id is null and rdo_request_line_code is null then
    error_messages := array_append(
      error_messages,
      'Submit your RDO request before submitting leave. Intake approval is not required first.'
    );
  end if;

  -- Serialize submissions that compete for the same role/area/date. The first
  -- transaction to commit becomes visible to the next capacity check.
  for leave_date in
    select distinct gs::date
    from jsonb_array_elements(requested_items) requested(item)
    cross join lateral generate_series(
      (requested.item ->> 'start_date')::date,
      (requested.item ->> 'end_date')::date,
      interval '1 day'
    ) gs
    where not exists (
      select 1
      from public.holidays h
      where h.bid_year_id = year_row.id
        and h.holiday_date = gs::date
    )
      and not exists (
        select 1
        from public.holiday_in_lieu_days h
        where h.bid_year_id = year_row.id
          and h.bidder_id = target.id
          and h.in_lieu_date = gs::date
      )
      and not (batch_round = 1 and exists (
        select 1 from public.rdo_line_days day
        where day.rdo_line_id = coalesce(target_rdo_line_id, submitted_rdo_line_id)
          and day.weekday = extract(dow from gs::date)::smallint and day.is_rdo
      ))
    order by gs::date
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        year_row.id::text || ':' || target.area_id::text || ':' || target_bucket || ':' || leave_date::text,
        0
      )
    );
  end loop;

  -- A configured row is one daily slot. Approved/held slots are already removed
  -- from the open count; pending requests are subtracted as reservations.
  with requested_dates as (
    select distinct gs::date as leave_date
    from jsonb_array_elements(requested_items) requested(item)
    cross join lateral generate_series(
      (requested.item ->> 'start_date')::date,
      (requested.item ->> 'end_date')::date,
      interval '1 day'
    ) gs
    where not exists (
      select 1
      from public.holidays h
      where h.bid_year_id = year_row.id
        and h.holiday_date = gs::date
    )
      and not exists (
        select 1
        from public.holiday_in_lieu_days h
        where h.bid_year_id = year_row.id
          and h.bidder_id = target.id
          and h.in_lieu_date = gs::date
      )
      and not (batch_round = 1 and exists (
        select 1 from public.rdo_line_days day
        where day.rdo_line_id = coalesce(target_rdo_line_id, submitted_rdo_line_id)
          and day.weekday = extract(dow from gs::date)::smallint and day.is_rdo
      ))
  ),
  open_slots as (
    select s.slot_date as leave_date, count(*)::integer as slot_count
    from public.leave_slots s
    join requested_dates requested on requested.leave_date = s.slot_date
    where s.bid_year_id = year_row.id
      and s.area_id = target.area_id
      and s.slot_group = target_bucket
      and s.status = 'open'
      and s.bidder_id is null
      and s.source_leave_request_id is null
    group by s.slot_date
  ),
  pending_reservations as (
    select d.leave_date, count(*)::integer as reservation_count
    from public.leave_request_dates d
    join public.leave_requests lr on lr.id = d.leave_request_id
    join public.bidders b on b.id = lr.bidder_id
    join requested_dates requested on requested.leave_date = d.leave_date
    where lr.bid_year_id = year_row.id
      and b.area_id = target.area_id
      and lr.status = 'pending'
      and d.charged
      and b.bid_role not in ('ADM', 'NB')
      and case
        when b.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
        else 'cpc'
      end = target_bucket
    group by d.leave_date
  )
  select array_agg(requested.leave_date order by requested.leave_date)
  into capacity_conflict_dates
  from requested_dates requested
  left join open_slots available on available.leave_date = requested.leave_date
  left join pending_reservations pending on pending.leave_date = requested.leave_date
  where coalesce(available.slot_count, 0) - coalesce(pending.reservation_count, 0) < 1;

  if cardinality(capacity_conflict_dates) > 0 then
    select string_agg(to_char(date_value, 'Mon FMDD, YYYY'), ', ' order by date_value)
    into conflict_date_labels
    from unnest(capacity_conflict_dates) date_value;

    error_messages := array_append(
      error_messages,
      format('No %s leave slot is available in %s on: %s.', upper(target_bucket), target_area, conflict_date_labels)
    );
  end if;

  -- A date already submitted in this or an earlier round cannot consume
  -- another slot.
  with requested_dates as (
    select distinct gs::date as leave_date
    from jsonb_array_elements(requested_items) requested(item)
    cross join lateral generate_series(
      (requested.item ->> 'start_date')::date,
      (requested.item ->> 'end_date')::date,
      interval '1 day'
    ) gs
  )
  select array_agg(distinct d.leave_date order by d.leave_date)
  into duplicate_conflict_dates
  from public.leave_request_dates d
  join public.leave_requests lr on lr.id = d.leave_request_id
  join requested_dates requested on requested.leave_date = d.leave_date
  where lr.bid_year_id = year_row.id
    and lr.bidder_id = target.id
    and lr.round_number <= batch_round
    and lr.status in ('pending', 'approved');

  if cardinality(duplicate_conflict_dates) > 0 then
    select string_agg(to_char(date_value, 'Mon FMDD, YYYY'), ', ' order by date_value)
    into conflict_date_labels
    from unnest(duplicate_conflict_dates) date_value;

    error_messages := array_append(
      error_messages,
      format('You already bid one or more of these dates: %s. Each date may be bid only once.', conflict_date_labels)
    );
  end if;

  -- Enforce the bidder's configured leave allowance on the server. The browser
  -- shows the same projection, but this is the authoritative protection against
  -- submitting additional ranges beyond the member's allotted hours.
  select case when coalesce(line.four_ten, false) then 10 else 8 end
  into leave_hours_per_day
  from public.rdo_lines line
  where line.id = coalesce(target_rdo_line_id, submitted_rdo_line_id);

  leave_hours_per_day := coalesce(leave_hours_per_day, 8);

  select count(*)::integer
  into requested_charged_days
  from jsonb_array_elements(requested_items) requested(item)
  cross join lateral pg_catalog.generate_series(
    (requested.item ->> 'start_date')::date::timestamp,
    (requested.item ->> 'end_date')::date::timestamp,
    interval '1 day'
  ) generated_date
  where (batch_round <= 3 or (not exists (
      select 1
      from public.holidays holiday
      where holiday.bid_year_id = year_row.id
        and holiday.holiday_date = generated_date::date
    )
    and not exists (
      select 1
      from public.holiday_in_lieu_days in_lieu
      where in_lieu.bid_year_id = year_row.id
        and in_lieu.bidder_id = target.id
        and in_lieu.in_lieu_date = generated_date::date
    )))
    and not (batch_round = 1 and exists (
      select 1 from public.rdo_line_days day
      where day.rdo_line_id = coalesce(target_rdo_line_id, submitted_rdo_line_id)
        and day.weekday = extract(dow from generated_date::date)::smallint and day.is_rdo
    ));

  select coalesce(sum(request.charged_days), 0)::integer
  into existing_charged_days
  from public.leave_requests request
  where request.bid_year_id = year_row.id
    and request.bidder_id = target.id
    and request.status in ('pending', 'approved');

  -- The private submitter builds Round 1's actual seven-day buckets, including
  -- dates that fit an existing bucket; a per-range estimate rejects those.
  if batch_round <> 1 then
    round_leave_limit := case when batch_round in (2, 3) then 10 else 5 end;

    select coalesce(sum(request.charged_days), 0)::integer
    into existing_round_usage
    from public.leave_requests request
    where request.bid_year_id = year_row.id
      and request.bidder_id = target.id
      and request.round_number = batch_round
      and request.status in ('pending', 'approved');

    if existing_round_usage + requested_charged_days > round_leave_limit then
      error_messages := array_append(
        error_messages,
        format(
          'Round %s can include no more than %s charged leave days. This batch would bring you to %s.',
          batch_round,
          round_leave_limit,
          existing_round_usage + requested_charged_days
        )
      );
    end if;
  end if;

  if batch_round >= 4 then
    select count(distinct request_date.leave_date)::integer
    into available_credit_days
    from public.leave_request_dates request_date
    join public.leave_requests request on request.id = request_date.leave_request_id
    where request.bid_year_id = year_row.id
      and request.bidder_id = target.id
      and request.round_number between 1 and 3
      and request.status in ('pending', 'approved')
      and request_date.charged
      and (request_date.is_holiday or request_date.is_holiday_in_lieu);

    select available_credit_days + coalesce(sum(credit.credit_days), 0)::integer
    into available_credit_days
    from public.leave_credit_events credit
    where credit.bid_year_id = year_row.id
      and credit.bidder_id = target.id
      and credit.round_number <= batch_round
      and credit.source = 'manual_adjustment';
  end if;

  maximum_leave_hours := target.leave_slot_allowance + (available_credit_days * leave_hours_per_day);
  projected_leave_hours := (existing_charged_days + requested_charged_days) * leave_hours_per_day;

  if projected_leave_hours > maximum_leave_hours then
    error_messages := array_append(
      error_messages,
      format(
        'This batch would use %s leave hours, above your %s-hour allowance.',
        projected_leave_hours,
        maximum_leave_hours
      )
    );
  end if;

  if cardinality(error_messages) > 0 then
    raise exception 'Your batch could not be submitted for review. %', array_to_string(error_messages, ' ');
  end if;

  return private.submit_leave_bid_batch_unchecked(
    requested_bid_year,
    requested_items,
    target_initials,
    target_area_name,
    manual_entry
  );
end
$function$;

create or replace function public.review_bidding_submission(
  submission_to_review uuid,
  decision text,
  denial_reason_text text default null,
  override_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  target public.bidders%rowtype;
  submission public.intake_submissions%rowtype;
  line_row public.rdo_lines%rowtype;
  leave_row public.leave_requests%rowtype;
  requested_group text;
  bucket text;
  slot_row public.leave_slots%rowtype;
  date_row record;
  area_max integer;
  crew_max integer;
  area_used integer;
  crew_used integer;
  target_area_name text;
  capacity_override boolean := coalesce((override_payload->>'leaveCapacityOverride')::boolean, false);
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email') and active
  for update;
  if actor.id is null or actor.role not in ('admin', 'intake') then raise exception 'Bidding reviewer access is required.'; end if;
  if decision not in ('approved', 'denied') then raise exception 'Decision must be approved or denied.'; end if;
  if decision = 'denied' and nullif(trim(denial_reason_text), '') is null then raise exception 'A denial reason is required.'; end if;

  select * into strict submission from public.intake_submissions where id = submission_to_review for update;
  if submission.status <> 'pending' then raise exception 'Only pending submissions can be reviewed.'; end if;
  select * into strict target from public.bidders where id = submission.bidder_id for update;
  select a.name into strict target_area_name from public.areas a where a.id = target.area_id;

  if submission.submission_type = 'rdo' then
    if override_payload ? 'line' then
      select * into strict line_row from public.rdo_lines rl
      where rl.bid_year_id = submission.bid_year_id and rl.area_id = target.area_id
        and rl.line_code = override_payload->>'line';
    else
      select * into strict line_row from public.rdo_lines where id = submission.rdo_line_id;
    end if;

    -- Lock every line in one stable order before collision/capacity checks so
    -- two reviewers cannot approve different lines into the same final slot.
    perform rl.id from public.rdo_lines rl
    where rl.bid_year_id = submission.bid_year_id and rl.area_id = target.area_id
    order by rl.id
    for update;
    select * into strict line_row from public.rdo_lines where id = line_row.id;

    if decision = 'approved' and not public.rdo_line_matches_bid_role(
      target.bid_role, target_area_name, line_row.line_type, line_row.pattern
    ) then
      raise exception 'RDO line % is not eligible for the bidder''s % role.', line_row.line_code, target.bid_role;
    end if;

    if decision = 'approved' and target.bid_role <> 'GL' then
      if line_row.status <> 'open' and line_row.assigned_bidder_id is distinct from target.id then
        raise exception 'RDO line % is already assigned to another bidder.', line_row.line_code;
      end if;
      requested_group := coalesce(override_payload->>'fatigueGroup', submission.payload->>'fatigueGroup');
      if requested_group not in ('A', 'B', 'C') then raise exception 'A valid fatigue group is required.'; end if;

      if line_row.line_type = 'CPC' then
        select greatest(1, floor(count(*)::numeric / 3)::integer) into area_max
        from public.rdo_lines rl where rl.bid_year_id = submission.bid_year_id
          and rl.area_id = target.area_id and rl.line_type = 'CPC';
        select greatest(1, floor(count(*)::numeric / 3)::integer) into crew_max
        from public.rdo_lines rl where rl.bid_year_id = submission.bid_year_id
          and rl.area_id = target.area_id and rl.line_type = 'CPC' and rl.pattern = line_row.pattern;
        select count(*) into area_used from public.rdo_lines rl
        where rl.bid_year_id = submission.bid_year_id and rl.area_id = target.area_id
          and rl.line_type = 'CPC' and rl.status = 'taken' and rl.fatigue_group = requested_group
          and rl.assigned_bidder_id is distinct from target.id;
        select count(*) into crew_used from public.rdo_lines rl
        where rl.bid_year_id = submission.bid_year_id and rl.area_id = target.area_id
          and rl.line_type = 'CPC' and rl.pattern = line_row.pattern and rl.status = 'taken'
          and rl.fatigue_group = requested_group and rl.assigned_bidder_id is distinct from target.id;
        if area_used >= area_max or crew_used >= crew_max then
          raise exception 'Fatigue group % is full for this area or crew.', requested_group;
        end if;
      end if;

      update public.rdo_lines
      set status = 'open', assigned_bidder_id = null, assigned_initials = null, updated_at = now()
      where bid_year_id = submission.bid_year_id and assigned_bidder_id = target.id and id <> line_row.id;

      update public.rdo_lines
      set status = 'taken', assigned_bidder_id = target.id, assigned_initials = target.initials,
          fatigue_group = requested_group,
          flex = coalesce((override_payload->>'flex')::boolean, (submission.payload->>'flex')::boolean),
          aws = coalesce((override_payload->>'aws')::boolean, (submission.payload->>'aws')::boolean),
          mid = coalesce(override_payload->>'mid', submission.payload->>'mid', mid), updated_at = now()
      where id = line_row.id;

      perform public.refresh_bidder_holiday_in_lieu(submission.bid_year_id, target.id);
    end if;
    update public.intake_submissions set rdo_line_id = line_row.id where id = submission.id;
  elsif submission.submission_type = 'leave' then
    select * into strict leave_row from public.leave_requests where id = submission.leave_request_id for update;
    if decision = 'approved' then
      if leave_row.round_number > 1 and exists (
        select 1 from public.leave_request_dates where leave_request_id = leave_row.id and is_rdo
      ) then raise exception 'Leave after Round 1 cannot include the bidder''s RDO.'; end if;

      bucket := case when target.bid_role in ('R-DEV', 'D-DEV', 'DEV') then 'dev' else 'cpc' end;
      for date_row in
        select d.leave_date from public.leave_request_dates d
        where d.leave_request_id = leave_row.id and d.charged
          and not d.is_holiday and not d.is_holiday_in_lieu
        order by d.leave_date
      loop
        select * into slot_row from public.leave_slots s
        where s.bid_year_id = submission.bid_year_id and s.area_id = target.area_id
          and s.slot_date = date_row.leave_date and s.slot_group = bucket and s.status = 'open'
        order by s.slot_code for update skip locked limit 1;

        if slot_row.id is null then
          if not capacity_override then raise exception 'Leave capacity is full on %.', date_row.leave_date; end if;
          insert into public.leave_slots (
            bid_year_id, area_id, slot_date, slot_group, slot_code, bidder_id,
            slot_initials, status, source_leave_request_id
          ) values (
            submission.bid_year_id, target.area_id, date_row.leave_date, bucket,
            'OVR-' || left(leave_row.id::text, 8), target.id, target.initials, 'approved', leave_row.id
          ) on conflict (bid_year_id, area_id, slot_date, slot_group, slot_code)
            do update set bidder_id = excluded.bidder_id, slot_initials = excluded.slot_initials,
              status = 'approved', source_leave_request_id = excluded.source_leave_request_id, updated_at = now();
        else
          update public.leave_slots
          set bidder_id = target.id, slot_initials = target.initials, status = 'approved',
              source_leave_request_id = leave_row.id, updated_at = now()
          where id = slot_row.id;
        end if;
        slot_row := null;
      end loop;

      update public.leave_requests set status = 'approved', reviewed_at = now(), reviewed_by = actor.id,
        denial_reason = null, updated_at = now() where id = leave_row.id;
    else
      update public.leave_requests set status = 'denied', reviewed_at = now(), reviewed_by = actor.id,
        denial_reason = denial_reason_text, updated_at = now() where id = leave_row.id;
    end if;
  else
    raise exception 'Only RDO and leave submissions can be reviewed here.';
  end if;

  update public.intake_submissions
  set status = decision, reviewed_at = now(), reviewed_by = actor.id,
      denial_reason = case when decision = 'denied' then denial_reason_text else null end,
      payload = payload || override_payload, updated_at = now()
  where id = submission.id;

  if submission.submission_type = 'rdo' and decision = 'denied' then
    perform public.refresh_bidder_holiday_in_lieu(submission.bid_year_id, target.id);
  end if;

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  values (submission.bid_year_id, submission.area_id, actor.id, 'submission_' || decision,
    'intake_submissions', submission.id, jsonb_build_object('bidder_id', target.id, 'override', override_payload));

  return jsonb_build_object('submission_id', submission.id, 'status', decision);
end
$$;

create or replace function private.recalculate_pending_leave_after_rdo_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status <> 'taken' or new.assigned_bidder_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = new.status
       and old.assigned_bidder_id is not distinct from new.assigned_bidder_id then
      return new;
    end if;
  end if;

  update public.leave_request_dates lrd
  set is_rdo = exists (
        select 1
        from public.rdo_line_days line_day
        where line_day.rdo_line_id = new.id
          and line_day.is_rdo
          and line_day.weekday = extract(dow from lrd.leave_date)::smallint
      ),
      charged = not (
          lr.round_number = 1
          and exists (
            select 1
            from public.rdo_line_days line_day
            where line_day.rdo_line_id = new.id
              and line_day.is_rdo
              and line_day.weekday = extract(dow from lrd.leave_date)::smallint
          )
        )
        and (lr.round_number <= 3
          or (not lrd.is_holiday and not lrd.is_holiday_in_lieu))
  from public.leave_requests lr
  where lrd.leave_request_id = lr.id
    and lr.bid_year_id = new.bid_year_id
    and lr.bidder_id = new.assigned_bidder_id
    and lr.status = 'pending';

  update public.leave_requests lr
  set charged_days = coalesce((
        select count(*)::integer
        from public.leave_request_dates lrd
        where lrd.leave_request_id = lr.id
          and lrd.charged
      ), 0),
      updated_at = now()
  where lr.bid_year_id = new.bid_year_id
    and lr.bidder_id = new.assigned_bidder_id
    and lr.status = 'pending';

  return new;
end
$function$;

-- Recalculate stored holiday charges if bids predate this rule. The production
-- database currently has no leave dates; this also protects other environments.
with changed as (
  update public.leave_request_dates d
  set charged = case
    when r.round_number = 1 and d.is_rdo then false
    when r.round_number <= 3 then true
    else false
  end
  from public.leave_requests r
  where r.id = d.leave_request_id
    and (d.is_holiday or d.is_holiday_in_lieu)
    and d.charged is distinct from case
      when r.round_number = 1 and d.is_rdo then false
      when r.round_number <= 3 then true
      else false
    end
  returning d.leave_request_id
)
update public.leave_requests r
set charged_days = (select count(*)::integer from public.leave_request_dates d
                    where d.leave_request_id = r.id and d.charged),
    updated_at = now()
where r.id in (select distinct leave_request_id from changed);

update public.intake_submissions s
set payload = jsonb_set(coalesce(s.payload, '{}'::jsonb), '{days}', to_jsonb(r.charged_days)),
    updated_at = now()
from public.leave_requests r
where s.leave_request_id = r.id and s.submission_type = 'leave'
  and s.payload->>'days' is distinct from r.charged_days::text;

create or replace view leave_request_totals as
select
  lr.id as leave_request_id,
  lr.bid_year_id,
  lr.bidder_id,
  lr.round_number,
  lr.status,
  (select count(*) from leave_request_dates d where d.leave_request_id = lr.id and d.charged) as charged_days,
  (select count(*) from leave_request_dates d where d.leave_request_id = lr.id and d.is_holiday) as holiday_days,
  (select count(*) from leave_request_dates d where d.leave_request_id = lr.id and d.is_holiday_in_lieu) as holiday_in_lieu_days,
  (select count(*) from leave_request_week_buckets bucket where bucket.leave_request_id = lr.id) as round_one_week_buckets
from leave_requests lr;

create or replace view bidder_leave_summary as
select
  bys.id as bid_year_id,
  b.id as bidder_id,
  bys.annual_leave_allowance_days,
  coalesce((select sum(lrt.charged_days)
            from leave_request_totals lrt
            where lrt.bid_year_id = bys.id and lrt.bidder_id = b.id
              and lrt.status in ('pending', 'approved')), 0) as leave_days_bid,
  coalesce((select sum(lrt.holiday_days + lrt.holiday_in_lieu_days)
            from leave_request_totals lrt
            where lrt.bid_year_id = bys.id and lrt.bidder_id = b.id
              and lrt.status in ('pending', 'approved')), 0) as holiday_related_days_bid,
  (coalesce((select count(distinct d.leave_date)
             from leave_request_dates d
             join leave_requests lr on lr.id = d.leave_request_id
             where lr.bid_year_id = bys.id and lr.bidder_id = b.id
               and lr.round_number between 1 and 3
               and lr.status in ('pending', 'approved') and d.charged
               and (d.is_holiday or d.is_holiday_in_lieu)), 0)
   + coalesce((select sum(lce.credit_days)
               from leave_credit_events lce
               where lce.bid_year_id = bys.id and lce.bidder_id = b.id
                 and lce.source = 'manual_adjustment'), 0))::bigint
    as holiday_credit_days_available
from bid_years bys
cross join bidders b;

revoke all on function public.refresh_bidder_holiday_in_lieu(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)
  from public,anon;
grant execute on function public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)
  to authenticated;
revoke all on function private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)
  from public,anon,authenticated;
revoke all on function public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)
  from public,anon;
grant execute on function public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)
  to authenticated;
revoke all on function public.review_bidding_submission(uuid,text,text,jsonb)
  from public,anon;
grant execute on function public.review_bidding_submission(uuid,text,text,jsonb)
  to authenticated;
revoke all on function private.recalculate_pending_leave_after_rdo_assignment()
  from public,anon,authenticated;

commit;
