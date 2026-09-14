-- Fix high-priority bidding invariants found during the post-implementation audit.
-- This migration is idempotent and preserves existing bidding records.

begin;

create or replace function public.rdo_line_matches_bid_role(
  bidder_role text,
  area_name text,
  requested_line_type text,
  requested_pattern text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when area_name = 'TMU' then
      bidder_role in ('TMC', 'TMCIT', 'GL') and requested_line_type = 'CPC'
    when bidder_role in ('CPC', 'GL') then requested_line_type = 'CPC'
    when bidder_role = 'R-DEV' then requested_line_type = 'DEV' and requested_pattern = 'R-DEV'
    when bidder_role = 'D-DEV' then requested_line_type = 'DEV' and requested_pattern = 'D-DEV'
    else false
  end
$$;

revoke all on function public.rdo_line_matches_bid_role(text,text,text,text) from public, anon;
grant execute on function public.rdo_line_matches_bid_role(text,text,text,text) to authenticated;

create or replace function public.enforce_leave_request_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  leave_bid_year integer;
begin
  select bys.bid_year into strict leave_bid_year
  from public.bid_years bys
  where bys.id = new.bid_year_id;

  if new.status in ('pending', 'approved')
     and (new.requested_start_date is null or new.requested_end_date is null) then
    raise exception 'Pending and approved leave requests require a complete date range.';
  end if;

  if new.requested_start_date is not null or new.requested_end_date is not null then
    if new.requested_start_date is null or new.requested_end_date is null
       or new.requested_end_date < new.requested_start_date then
      raise exception 'Invalid leave date range.';
    end if;
    if new.requested_start_date < make_date(leave_bid_year, 1, 10)
       or new.requested_end_date > make_date(leave_bid_year + 1, 1, 8) then
      raise exception 'Leave must stay between Jan 10, % and Jan 8, %.', leave_bid_year, leave_bid_year + 1;
    end if;
  end if;

  if new.status in ('pending', 'approved') then
    perform b.id from public.bidders b where b.id = new.bidder_id for update;
    if exists (
      select 1
      from public.leave_requests lr
      where lr.bid_year_id = new.bid_year_id
        and lr.bidder_id = new.bidder_id
        and lr.status in ('pending', 'approved')
        and lr.id <> new.id
        and daterange(lr.requested_start_date, lr.requested_end_date, '[]')
          && daterange(new.requested_start_date, new.requested_end_date, '[]')
    ) then
      raise exception 'Leave request overlaps an existing pending or approved request.';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists leave_requests_enforce_invariants on public.leave_requests;
create trigger leave_requests_enforce_invariants
before insert or update of bid_year_id, bidder_id, status, requested_start_date, requested_end_date
on public.leave_requests
for each row execute function public.enforce_leave_request_invariants();

create or replace function public.enforce_rdo_submission_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.bidders%rowtype;
  requested_line public.rdo_lines%rowtype;
  target_area_name text;
begin
  if new.submission_type <> 'rdo' or new.rdo_line_id is null then return new; end if;
  select * into strict target from public.bidders where id = new.bidder_id;
  select * into strict requested_line from public.rdo_lines where id = new.rdo_line_id;
  select a.name into strict target_area_name from public.areas a where a.id = target.area_id;

  if requested_line.area_id is distinct from target.area_id
     or not public.rdo_line_matches_bid_role(
       target.bid_role, target_area_name, requested_line.line_type, requested_line.pattern
     ) then
    raise exception 'RDO line % is not eligible for the bidder''s % role.', requested_line.line_code, target.bid_role;
  end if;
  return new;
end
$$;

drop trigger if exists intake_submissions_enforce_rdo_eligibility on public.intake_submissions;
create trigger intake_submissions_enforce_rdo_eligibility
before insert or update of bidder_id, rdo_line_id, submission_type
on public.intake_submissions
for each row execute function public.enforce_rdo_submission_eligibility();

create or replace function public.enforce_rdo_assignment_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.bidders%rowtype;
  target_area_name text;
begin
  if new.assigned_bidder_id is null then return new; end if;
  select * into strict target from public.bidders where id = new.assigned_bidder_id;
  select a.name into strict target_area_name from public.areas a where a.id = target.area_id;
  if new.area_id is distinct from target.area_id
     or not public.rdo_line_matches_bid_role(
       target.bid_role, target_area_name, new.line_type, new.pattern
     ) then
    raise exception 'RDO line % is not eligible for the bidder''s % role.', new.line_code, target.bid_role;
  end if;
  return new;
end
$$;

drop trigger if exists rdo_lines_enforce_assignment_eligibility on public.rdo_lines;
create trigger rdo_lines_enforce_assignment_eligibility
before insert or update of area_id, line_type, pattern, assigned_bidder_id
on public.rdo_lines
for each row execute function public.enforce_rdo_assignment_eligibility();

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
  committed_charged integer;
  committed_round_charged integer;
  existing_request_count integer;
  all_dates date[];
  bucket_starts date[] := array[]::date[];
  bucket_start date;
  is_rdo boolean;
  is_holiday boolean;
  is_in_lieu boolean;
  result_ids jsonb := '[]'::jsonb;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email') and active
  for update;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;

  select * into strict year_row from public.bid_years where bid_year = requested_bid_year;
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
        where rl.bid_year_id = year_row.id and rl.assigned_bidder_id = target.id
          and rl.status = 'taken' and d.is_rdo and d.weekday = extract(dow from leave_date)::smallint
      ) into is_rdo;
      select exists (select 1 from public.holidays h where h.bid_year_id = year_row.id and h.holiday_date = leave_date) into is_holiday;
      select exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id = year_row.id and h.bidder_id = target.id and h.in_lieu_date = leave_date) into is_in_lieu;
      if round_no > 1 and is_rdo then raise exception 'Leave cannot include the bidder''s RDO after Round 1 (%).', leave_date; end if;
      if not is_holiday and not is_in_lieu and not (round_no = 1 and is_rdo) then item_charged := item_charged + 1; end if;
    end loop;
    batch_charged := batch_charged + item_charged;
  end loop;

  if not manual_entry and not exists (
    select 1 from public.bid_windows bw where bw.bid_year_id = year_row.id and bw.bidder_id = target.id
      and bw.round_number = batch_round and now() >= bw.opens_at and now() < bw.closes_at
  ) then raise exception 'Your bidding window is not open.'; end if;

  if batch_round = 1 then
    select coalesce(array_agg(distinct wb.bucket_start_date order by wb.bucket_start_date), array[]::date[])
    into bucket_starts
    from public.leave_request_week_buckets wb
    join public.leave_requests lr on lr.id = wb.leave_request_id
    where lr.bid_year_id = year_row.id and lr.bidder_id = target.id
      and lr.round_number = 1 and lr.status in ('pending', 'approved');

    foreach leave_date in array all_dates loop
      if not exists (
        select 1 from unnest(bucket_starts) as existing_buckets(existing_start)
        where leave_date between existing_start and existing_start + 6
      ) then
        bucket_starts := array_append(bucket_starts, leave_date);
      end if;
    end loop;
    if cardinality(bucket_starts) > 2 then raise exception 'Round 1 can include at most two consecutive seven-day buckets.'; end if;
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

  select coalesce(sum(charged_days), 0) into committed_charged
  from public.leave_requests
  where bid_year_id = year_row.id and bidder_id = target.id and status in ('pending', 'approved');
  if committed_charged + batch_charged > year_row.annual_leave_allowance_days then
    raise exception 'The annual leave allowance would be exceeded.';
  end if;

  select count(*) into existing_request_count from public.leave_requests
  where bid_year_id = year_row.id and bidder_id = target.id and status in ('pending', 'approved');
  if existing_request_count + jsonb_array_length(requested_items) > target.leave_slot_allowance then
    raise exception 'The bidder''s leave-slot allowance would be exceeded.';
  end if;

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
        where rl.bid_year_id = year_row.id and rl.assigned_bidder_id = target.id
          and rl.status = 'taken' and d.is_rdo and d.weekday = extract(dow from leave_date)::smallint
      ) into is_rdo;
      select exists (select 1 from public.holidays h where h.bid_year_id = year_row.id and h.holiday_date = leave_date) into is_holiday;
      select exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id = year_row.id and h.bidder_id = target.id and h.in_lieu_date = leave_date) into is_in_lieu;
      if not is_holiday and not is_in_lieu and not (round_no = 1 and is_rdo) then item_charged := item_charged + 1; end if;
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
        where rl.bid_year_id = year_row.id and rl.assigned_bidder_id = target.id
          and rl.status = 'taken' and d.is_rdo and d.weekday = extract(dow from leave_date)::smallint
      ) into is_rdo;
      select exists (select 1 from public.holidays h where h.bid_year_id = year_row.id and h.holiday_date = leave_date) into is_holiday;
      select exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id = year_row.id and h.bidder_id = target.id and h.in_lieu_date = leave_date) into is_in_lieu;
      insert into public.leave_request_dates (leave_request_id, leave_date, charged, is_rdo, is_holiday, is_holiday_in_lieu)
      values (request_id, leave_date, not is_holiday and not is_in_lieu and not (round_no = 1 and is_rdo), is_rdo, is_holiday, is_in_lieu);
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

  return jsonb_build_object('submission_ids', result_ids, 'round', batch_round, 'charged_days', batch_charged);
end
$$;

revoke all on function public.submit_leave_bid_batch(integer,jsonb,text,text,boolean) from public, anon;
grant execute on function public.submit_leave_bid_batch(integer,jsonb,text,text,boolean) to authenticated;

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
        where d.leave_request_id = leave_row.id and d.charged order by d.leave_date
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

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  values (submission.bid_year_id, submission.area_id, actor.id, 'submission_' || decision,
    'intake_submissions', submission.id, jsonb_build_object('bidder_id', target.id, 'override', override_payload));

  return jsonb_build_object('submission_id', submission.id, 'status', decision);
end
$$;

revoke all on function public.review_bidding_submission(uuid,text,text,jsonb) from public, anon;
grant execute on function public.review_bidding_submission(uuid,text,text,jsonb) to authenticated;
create or replace function public.read_bidding_state(requested_bid_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  year_id uuid;
  result jsonb;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email') and active;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;
  select id into strict year_id from public.bid_years where bid_year = requested_bid_year;

  select jsonb_build_object(
    'submissions', coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'type', case when s.submission_type = 'rdo' then 'RDO Line' else 'Leave' end,
      'status', initcap(s.status), 'round', s.round_number, 'area', a.name,
      'name', b.first_name || ' ' || b.last_name, 'initials', b.initials,
      'bidAs', b.bid_role, 'seniority', b.seniority_rank,
      'submittedAt', s.submitted_at, 'reviewedAt', s.reviewed_at,
      'reviewedBy', reviewer.initials, 'denialReason', s.denial_reason,
      'line', rl.line_code, 'range', case
        when lr.id is null then null
        when lr.requested_end_date = lr.requested_start_date then to_char(lr.requested_start_date, 'Mon FMDD, YYYY')
        when extract(year from lr.requested_start_date) = extract(year from lr.requested_end_date) then
          to_char(lr.requested_start_date, 'Mon FMDD') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
        else to_char(lr.requested_start_date, 'Mon FMDD, YYYY') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
      end,
      'days', lr.charged_days, 'payload', s.payload
    ) order by s.submitted_at desc), '[]'::jsonb)
  ) into result
  from public.intake_submissions s
  left join public.bidders b on b.id = s.bidder_id
  left join public.areas a on a.id = s.area_id
  left join public.bidders reviewer on reviewer.id = s.reviewed_by
  left join public.rdo_lines rl on rl.id = s.rdo_line_id
  left join public.leave_requests lr on lr.id = s.leave_request_id
  where s.bid_year_id = year_id
    and s.submission_type in ('rdo', 'leave')
    and (actor.role in ('admin', 'intake') or s.area_id = actor.area_id)
    and (actor.role in ('admin', 'intake') or s.bidder_id = actor.id);

  return coalesce(result, jsonb_build_object('submissions', '[]'::jsonb));
end
$$;

revoke all on function public.read_bidding_state(integer) from public, anon;
grant execute on function public.read_bidding_state(integer) to authenticated;

commit;
