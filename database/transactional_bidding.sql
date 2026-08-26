-- Transactional bidding operations and the authoritative four-round schedule.
-- All browser writes go through these functions so window, collision, capacity,
-- leave-charge, and approval rules are checked inside one database transaction.

alter table public.bidders
  add column if not exists leave_slot_allowance integer not null default 4;

alter table public.rdo_lines
  add column if not exists assigned_initials text;

alter table public.intake_submissions
  add column if not exists round_number integer,
  add column if not exists rdo_line_id uuid references public.rdo_lines(id) on delete set null,
  add column if not exists leave_request_id uuid references public.leave_requests(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.bidders'::regclass and conname = 'bidders_leave_slot_allowance_check') then
    alter table public.bidders add constraint bidders_leave_slot_allowance_check check (leave_slot_allowance >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.intake_submissions'::regclass and conname = 'intake_submissions_round_number_check') then
    alter table public.intake_submissions add constraint intake_submissions_round_number_check check (round_number between 1 and 4);
  end if;
end
$$;

alter table public.bid_rounds drop constraint if exists bid_rounds_round_number_check;
alter table public.bid_rounds add constraint bid_rounds_round_number_check check (round_number between 1 and 4);
alter table public.bid_windows drop constraint if exists bid_windows_round_number_check;
alter table public.bid_windows add constraint bid_windows_round_number_check check (round_number between 1 and 4);
alter table public.leave_requests drop constraint if exists leave_requests_round_number_check;
alter table public.leave_requests add constraint leave_requests_round_number_check check (round_number between 1 and 4);
alter table public.leave_credit_events drop constraint if exists leave_credit_events_round_number_check;
alter table public.leave_credit_events add constraint leave_credit_events_round_number_check check (round_number between 1 and 4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leave_slots'::regclass
      and conname = 'leave_slots_source_leave_request_id_fkey'
  ) then
    alter table public.leave_slots
      add constraint leave_slots_source_leave_request_id_fkey
      foreign key (source_leave_request_id) references public.leave_requests(id) on delete set null;
  end if;
end
$$;

create unique index if not exists intake_submissions_one_pending_rdo_idx
  on public.intake_submissions(bid_year_id, bidder_id, round_number)
  where submission_type = 'rdo' and status = 'pending';

create index if not exists bid_windows_open_lookup_idx
  on public.bid_windows(bidder_id, opens_at, closes_at, round_number);

create index if not exists rdo_lines_assignment_idx
  on public.rdo_lines(bid_year_id, assigned_bidder_id)
  where assigned_bidder_id is not null;

create unique index if not exists rdo_lines_one_assignment_per_bidder_idx
  on public.rdo_lines(bid_year_id, assigned_bidder_id)
  where assigned_bidder_id is not null and status = 'taken';

create index if not exists leave_slots_available_idx
  on public.leave_slots(bid_year_id, area_id, slot_date, slot_group, slot_code)
  where status = 'open';

create or replace function public.is_current_bidding_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.bidders b
    where b.auth_user_id = auth.uid()
      and lower(b.email) = lower(auth.jwt() ->> 'email')
      and b.role in ('admin', 'intake')
      and b.active
  )
$$;

revoke all on function public.is_current_bidding_reviewer() from public, anon;
grant execute on function public.is_current_bidding_reviewer() to authenticated;

create or replace function public.rebuild_bid_schedule(schedule_bid_year integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_row public.bid_years%rowtype;
  area_row public.areas%rowtype;
  bidder_row record;
  round_no integer;
  bidder_index integer;
  slot_index integer;
  working_date date;
  final_date date;
  opens_at timestamptz;
  closes_at timestamptz;
begin
  if auth.uid() is not null and not public.is_current_bidding_reviewer() then
    raise exception 'Bidding reviewer access is required.';
  end if;

  select * into strict year_row
  from public.bid_years
  where bid_year = schedule_bid_year;

  delete from public.bid_windows where bid_year_id = year_row.id;
  delete from public.bid_rounds where bid_year_id = year_row.id;

  for round_no in 1..4 loop
    insert into public.bid_rounds (bid_year_id, round_number, label, status)
    values (year_row.id, round_no, 'Round ' || round_no, 'scheduled');
  end loop;

  for area_row in
    select a.* from public.areas a order by a.display_order, a.name
  loop
    working_date := make_date(schedule_bid_year - 1, 10, 1);

    for round_no in 1..4 loop
      bidder_index := 0;
      final_date := null;

      for bidder_row in
        select b.id
        from public.bidders b
        where b.area_id = area_row.id and b.active and b.seniority_rank is not null
        order by b.seniority_rank, b.last_name, b.first_name, b.id
      loop
        if bidder_index > 0 and bidder_index % 6 = 0 then
          working_date := working_date + 1;
        end if;

        while working_date in (make_date(schedule_bid_year - 1, 10, 12), make_date(schedule_bid_year - 1, 11, 11)) loop
          working_date := working_date + 1;
        end loop;

        slot_index := bidder_index % 6;
        opens_at := make_timestamptz(
          extract(year from working_date)::integer,
          extract(month from working_date)::integer,
          extract(day from working_date)::integer,
          7 + (slot_index * 2), 0, 0, 'America/Los_Angeles'
        );
        closes_at := opens_at + interval '2 hours';

        insert into public.bid_windows (
          bid_year_id, bidder_id, round_number, opens_at, closes_at, status
        ) values (
          year_row.id, bidder_row.id, round_no, opens_at, closes_at, 'scheduled'
        );

        final_date := working_date;
        bidder_index := bidder_index + 1;
      end loop;

      if final_date is not null then
        update public.bid_rounds br
        set starts_at = least(br.starts_at, (
              select min(bw.opens_at) from public.bid_windows bw
              join public.bidders b on b.id = bw.bidder_id
              where bw.bid_year_id = year_row.id and bw.round_number = round_no and b.area_id = area_row.id
            )),
            ends_at = greatest(br.ends_at, (
              select max(bw.closes_at) from public.bid_windows bw
              join public.bidders b on b.id = bw.bidder_id
              where bw.bid_year_id = year_row.id and bw.round_number = round_no and b.area_id = area_row.id
            ))
        where br.bid_year_id = year_row.id and br.round_number = round_no;

        -- The final window closes at 1900. Three calendar dates later at 0700
        -- is exactly the required 60-hour validation boundary.
        working_date := final_date + 3;
        while working_date in (make_date(schedule_bid_year - 1, 10, 12), make_date(schedule_bid_year - 1, 11, 11)) loop
          working_date := working_date + 1;
        end loop;
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function public.rebuild_bid_schedule(integer) from public, anon;
grant execute on function public.rebuild_bid_schedule(integer) to authenticated;

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

  if line_id is null then return; end if;

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
end
$$;

revoke all on function public.refresh_bidder_holiday_in_lieu(uuid, uuid) from public, anon, authenticated;

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
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
    and active
  for update;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;

  select * into strict year_row from public.bid_years where bid_year = requested_bid_year;

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

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  values (year_row.id, target.area_id, actor.id, 'rdo_bid_submitted', 'intake_submissions', submission_id,
    jsonb_build_object('target_bidder_id', target.id, 'line_code', line_row.line_code, 'round', resolved_round));

  return jsonb_build_object('submission_id', submission_id, 'round', resolved_round);
end
$$;

revoke all on function public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean) from public, anon;
grant execute on function public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean) to authenticated;

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

create or replace function public.update_pending_rdo_submission(
  submission_to_update uuid,
  requested_line_code text,
  requested_fatigue_group text,
  requested_flex boolean,
  requested_aws boolean,
  requested_mid text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  submission public.intake_submissions%rowtype;
  target public.bidders%rowtype;
  line_id uuid;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid() and lower(email) = lower(auth.jwt() ->> 'email') and active;
  if actor.id is null or actor.role not in ('admin', 'intake') then raise exception 'Bidding reviewer access is required.'; end if;

  select * into strict submission from public.intake_submissions where id = submission_to_update for update;
  if submission.status <> 'pending' or submission.submission_type <> 'rdo' then
    raise exception 'Only pending RDO submissions can be edited.';
  end if;
  select * into strict target from public.bidders where id = submission.bidder_id;
  select rl.id into strict line_id from public.rdo_lines rl
  where rl.bid_year_id = submission.bid_year_id and rl.area_id = target.area_id
    and rl.line_code = requested_line_code;

  update public.intake_submissions
  set rdo_line_id = line_id,
      payload = payload || jsonb_build_object(
        'line', requested_line_code, 'fatigueGroup', requested_fatigue_group,
        'flex', requested_flex, 'aws', requested_aws, 'mid', requested_mid
      ), updated_at = now()
  where id = submission.id;

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  values (submission.bid_year_id, submission.area_id, actor.id, 'pending_rdo_edited',
    'intake_submissions', submission.id, jsonb_build_object('line_code', requested_line_code));
  return jsonb_build_object('submission_id', submission.id, 'status', 'pending');
end
$$;

revoke all on function public.update_pending_rdo_submission(uuid,text,text,boolean,boolean,text) from public, anon;
grant execute on function public.update_pending_rdo_submission(uuid,text,text,boolean,boolean,text) to authenticated;

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

    if decision = 'approved' and target.bid_role <> 'GL' then
      if line_row.status <> 'open' and line_row.assigned_bidder_id is distinct from target.id then
        raise exception 'RDO line % is already assigned to another bidder.', line_row.line_code;
      end if;
      requested_group := coalesce(override_payload->>'fatigueGroup', submission.payload->>'fatigueGroup');
      if requested_group not in ('A', 'B', 'C') then raise exception 'A valid fatigue group is required.'; end if;

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
      'line', rl.line_code, 'range', case when lr.id is null then null else
        to_char(lr.requested_start_date, 'Mon FMDD') || case when lr.requested_end_date = lr.requested_start_date then '' else
        ' - ' || to_char(lr.requested_end_date, 'Mon FMDD') end || ', ' || extract(year from lr.requested_end_date)::integer end,
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

-- Seed daily capacity for the complete leave year. Existing assignments survive.
insert into public.leave_slots (bid_year_id, area_id, slot_date, slot_group, slot_code, status)
select bys.id, a.id, d::date, slots.slot_group, slots.slot_code, 'open'
from public.bid_years bys
cross join public.areas a
cross join lateral generate_series(make_date(bys.bid_year, 1, 10), make_date(bys.bid_year + 1, 1, 8), interval '1 day') d
cross join (values ('cpc', 'C1'), ('cpc', 'C2'), ('cpc', 'C3'), ('dev', 'D1')) slots(slot_group, slot_code)
where bys.bid_year = 2027
on conflict (bid_year_id, area_id, slot_date, slot_group, slot_code) do nothing;

select public.rebuild_bid_schedule(2027);

do $$
declare
  assignment record;
begin
  for assignment in
    select distinct rl.bid_year_id, rl.assigned_bidder_id
    from public.rdo_lines rl
    where rl.assigned_bidder_id is not null and rl.status = 'taken'
  loop
    perform public.refresh_bidder_holiday_in_lieu(assignment.bid_year_id, assignment.assigned_bidder_id);
  end loop;
end
$$;

grant select on public.bid_years, public.areas, public.bid_rounds, public.bid_windows,
  public.holidays, public.holiday_in_lieu_days, public.rdo_lines, public.rdo_line_days,
  public.leave_slots to authenticated;
grant select on public.bid_years, public.areas, public.bid_rounds, public.holidays,
  public.rdo_lines, public.rdo_line_days, public.leave_slots to anon;

-- Prevent direct PostgREST mutations from bypassing the transactional rules.
revoke insert, update, delete on public.bid_windows, public.rdo_lines, public.rdo_line_days,
  public.holiday_in_lieu_days, public.leave_slots, public.leave_requests,
  public.leave_request_dates, public.leave_request_week_buckets, public.leave_credit_events,
  public.intake_submissions, public.audit_events from anon, authenticated;
