-- Round 2/3 limits and leave-day hours follow the selected line's RDO count.
-- A three-RDO line is 4/10; a two-RDO line is 5/8.
create or replace function private.rdo_count_for_line(line_id uuid)
returns integer language sql stable set search_path = '' as $function$
  select count(*)::integer from public.rdo_line_days
  where rdo_line_id = line_id and is_rdo
$function$;

create or replace function private.leave_hours_for_line(line_id uuid)
returns integer language sql stable set search_path = '' as $function$
  select case private.rdo_count_for_line(line_id) when 3 then 10 else 8 end
$function$;

create or replace function private.round_two_three_limit_for_line(line_id uuid)
returns integer language sql stable set search_path = '' as $function$
  select case private.rdo_count_for_line(line_id) when 3 then 8 else 10 end
$function$;

-- Correct the existing 2027 metadata as well as using the RDO count in checks.
update public.rdo_lines line
set four_ten = (private.rdo_count_for_line(line.id) = 3)
from public.bid_years year_row
where year_row.id = line.bid_year_id and year_row.bid_year = 2027
  and private.rdo_count_for_line(line.id) in (2, 3)
  and line.four_ten is distinct from (private.rdo_count_for_line(line.id) = 3);

-- Override the active bidder submission and edit routines.

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
    if batch_round in (2, 3) and committed_round_charged + batch_charged > private.round_two_three_limit_for_line(effective_rdo_line_id) then
      raise exception 'Round % can include at most % charged days total.', batch_round, private.round_two_three_limit_for_line(effective_rdo_line_id);
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

  if batch_round > 1 then
    select array_agg(distinct generated_date::date order by generated_date::date)
    into capacity_conflict_dates
    from jsonb_array_elements(requested_items) requested(item)
    cross join lateral pg_catalog.generate_series(
      (requested.item ->> 'start_date')::date::timestamp,
      (requested.item ->> 'end_date')::date::timestamp,
      interval '1 day'
    ) generated_date
    join public.rdo_line_days day
      on day.rdo_line_id = coalesce(target_rdo_line_id, submitted_rdo_line_id)
     and day.weekday = extract(dow from generated_date::date)::smallint
     and day.is_rdo;
    if cardinality(capacity_conflict_dates) > 0 then
      select string_agg(to_char(date_value, 'Mon FMDD, YYYY'), ', ' order by date_value)
      into conflict_date_labels
      from unnest(capacity_conflict_dates) date_value;
      error_messages := array_append(error_messages,
        format('Round %s leave cannot include your RDO dates: %s.', batch_round, conflict_date_labels));
    end if;
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
  leave_hours_per_day := private.leave_hours_for_line(coalesce(target_rdo_line_id, submitted_rdo_line_id));

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
    round_leave_limit := case when batch_round in (2, 3) then private.round_two_three_limit_for_line(coalesce(target_rdo_line_id, submitted_rdo_line_id)) else 5 end;

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

do $upgrade$ begin
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
    round_limit := case when request_row.round_number in (2, 3) then private.round_two_three_limit_for_line(target_rdo_line_id) else 5 end;

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

  leave_hours_per_day := private.leave_hours_for_line(target_rdo_line_id);
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
end $upgrade$;

do $upgrade$ begin
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
    round_limit := case when request_row.round_number in (2, 3) then private.round_two_three_limit_for_line(target_rdo_line_id) else 5 end;

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
end $upgrade$;

do $upgrade$ begin
  if to_regprocedure('private.save_bidder_editor(integer,uuid,jsonb,jsonb)') is not null then
    execute $definition$
create or replace function private.save_bidder_editor(requested_bid_year integer, target_bidder_id uuid, expected_snapshot jsonb, changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid; target public.bidders%rowtype; year_id uuid; before_state jsonb;
  line_row public.rdo_lines%rowtype; line_change jsonb; entry jsonb; prior jsonb;
  rdo_id uuid; rdo_status text; group_name text; area_max integer; crew_max integer;
  start_day date; end_day date; round_no integer; day_hours integer; used_hours integer; credit_days integer; manual_credit_days integer;
  bucket text; d date; r record;
begin
  actor_id := private.bidder_editor_actor(target_bidder_id);
  select * into strict target from public.bidders where id=target_bidder_id for update;
  if target.bid_role in ('ADM', 'NB') then
    raise exception 'This profile cannot be edited as a bidder.';
  end if;
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
  if line_row.id is null then
    select * into line_row from public.rdo_lines
    where id = coalesce((before_state->'assignment'->>'id')::uuid,
                        (before_state->'rdo'->>'rdo_line_id')::uuid);
  end if;
  -- Charge totals must be checked again after an RDO change (including 4-10 lines).
  day_hours := private.leave_hours_for_line(line_row.id);
  for round_no in 2..3 loop
    if (select coalesce(sum(charged_days),0) from public.leave_requests
        where bid_year_id=year_id and bidder_id=target.id
          and status in ('pending','approved') and round_number=round_no)
       > private.round_two_three_limit_for_line(line_row.id) then
      raise exception 'Round % exceeds the % day limit for this RDO line.',
        round_no, private.round_two_three_limit_for_line(line_row.id);
    end if;
  end loop;
  for round_no in 1..5 loop
    select coalesce(sum(charged_days),0)*day_hours into used_hours from public.leave_requests
      where bid_year_id=year_id and bidder_id=target.id and status in ('pending','approved') and round_number<=round_no;
    credit_days := 0;
    if round_no >= 4 then
      select count(distinct d.leave_date) into credit_days
      from public.leave_request_dates d join public.leave_requests request on request.id=d.leave_request_id
      where request.bid_year_id=year_id and request.bidder_id=target.id
        and request.round_number between 1 and 3 and request.status in ('pending','approved')
        and d.charged and (d.is_holiday or d.is_holiday_in_lieu);
      select coalesce(sum(c.credit_days),0) into manual_credit_days from public.leave_credit_events c
        where c.bid_year_id=year_id and c.bidder_id=target.id and c.round_number<=round_no
          and c.source='manual_adjustment';
      credit_days := credit_days + manual_credit_days;
    end if;
    if used_hours > target.leave_slot_allowance+credit_days*day_hours then
      raise exception 'Round % would use % leave hours, above the % hour allowance.',round_no,used_hours,target.leave_slot_allowance+credit_days*day_hours;
    end if;
  end loop;
  insert into public.audit_events(bid_year_id,area_id,actor_id,event_type,entity_table,entity_id,details)
    values(year_id,target.area_id,actor_id,'bidder_bids_edited','bidders',target.id,
      jsonb_build_object('before',before_state,'after',private.bidder_editor_snapshot(year_id,target.id)));
  return jsonb_build_object('valid',true,'saved',true,'snapshot',private.bidder_editor_snapshot(year_id,target.id));
end $$;
$definition$;
  end if;
end $upgrade$;
