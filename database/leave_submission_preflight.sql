-- Validate leave availability, prior-round duplicates, and RDO conflicts before
-- a leave batch is inserted into the intake queue.
--
-- The existing submit_leave_bid_batch function remains the owner of round rules
-- and persistence. This migration moves it behind a private wrapper so the
-- preflight checks and the insert execute in one database transaction.

create schema if not exists private;

create table if not exists public.bid_year_settings (
  bid_year_id uuid primary key references public.bid_years(id) on delete cascade,
  enforce_bid_windows boolean not null default true,
  test_bid_round integer check (test_bid_round between 1 and 4),
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bid_year_settings
  add column if not exists test_bid_round integer;

alter table public.bid_year_settings enable row level security;

do $migration$
begin
  if to_regprocedure('private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)') is null then
    if to_regprocedure('public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)') is null then
      raise exception 'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean) must exist before applying this migration';
    end if;

    alter function public.submit_leave_bid_batch(integer, jsonb, text, text, boolean)
      rename to submit_leave_bid_batch_unchecked;
    alter function public.submit_leave_bid_batch_unchecked(integer, jsonb, text, text, boolean)
      set schema private;
  end if;
end
$migration$;

revoke all on function private.submit_leave_bid_batch_unchecked(integer, jsonb, text, text, boolean)
  from public, anon, authenticated;

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
  open_bid_window_id uuid;
  enforce_bid_windows boolean := true;
  configured_test_round integer;
  capacity_conflict_dates date[];
  duplicate_conflict_dates date[];
  rdo_conflict_dates date[];
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
      and now() <= bw.closes_at
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

  -- A date already submitted in an earlier round cannot consume another slot.
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
    and lr.round_number < batch_round
    and lr.status in ('pending', 'approved');

  if cardinality(duplicate_conflict_dates) > 0 then
    select string_agg(to_char(date_value, 'Mon FMDD, YYYY'), ', ' order by date_value)
    into conflict_date_labels
    from unnest(duplicate_conflict_dates) date_value;

    error_messages := array_append(
      error_messages,
      format('You already bid the same date in a previous round: %s. Each date may be bid only once across rounds.', conflict_date_labels)
    );
  end if;

  -- Prefer an already populated line. Otherwise use the line submitted with
  -- the leave batch or the latest pending/approved RDO intake payload and
  -- atomically stamp it as assigned if it is still available.
  select rl.id
  into target_rdo_line_id
  from public.rdo_lines rl
  where rl.bid_year_id = year_row.id
    and rl.area_id = target.area_id
    and rl.assigned_bidder_id = target.id
    and rl.status = 'taken'
  order by rl.updated_at desc, rl.id
  limit 1;

  if target_rdo_line_id is null and submitted_rdo_line_code is null then
    select coalesce(
      nullif(submission.payload ->> 'rdo_line_code', ''),
      nullif(submission.payload ->> 'line', '')
    )
    into submitted_rdo_line_code
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
    else
      update public.rdo_lines
      set status = 'taken',
          assigned_bidder_id = target.id,
          updated_at = now()
      where id = submitted_rdo_line_id
        and (
          status = 'open'
          or (status = 'taken' and assigned_bidder_id = target.id)
        );

      target_rdo_line_id := submitted_rdo_line_id;
    end if;
  end if;

  if target_rdo_line_id is null then
    error_messages := array_append(
      error_messages,
      'Choose an available RDO line before submitting leave so the system can check RDO conflicts.'
    );
  else
    with requested_dates as (
      select distinct gs::date as leave_date
      from jsonb_array_elements(requested_items) requested(item)
      cross join lateral generate_series(
        (requested.item ->> 'start_date')::date,
        (requested.item ->> 'end_date')::date,
        interval '1 day'
      ) gs
    )
    select array_agg(requested.leave_date order by requested.leave_date)
    into rdo_conflict_dates
    from requested_dates requested
    join public.rdo_line_days line_day
      on line_day.rdo_line_id = target_rdo_line_id
     and line_day.is_rdo
     and line_day.weekday = extract(dow from requested.leave_date)::smallint;

    if cardinality(rdo_conflict_dates) > 0 then
      select string_agg(to_char(date_value, 'Mon FMDD, YYYY'), ', ' order by date_value)
      into conflict_date_labels
      from unnest(rdo_conflict_dates) date_value;

      error_messages := array_append(
        error_messages,
        format('These dates are RDOs on your approved bid line: %s.', conflict_date_labels)
      );
    end if;
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

revoke all on function public.submit_leave_bid_batch(integer, jsonb, text, text, boolean)
  from public, anon;
grant execute on function public.submit_leave_bid_batch(integer, jsonb, text, text, boolean)
  to authenticated;

comment on function public.submit_leave_bid_batch(integer, jsonb, text, text, boolean) is
  'Atomically validates bid windows, role-specific daily capacity, prior-round duplicate dates, and bid-line RDOs before submitting a leave batch for intake review.';
