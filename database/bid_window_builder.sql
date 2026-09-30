-- Atomic bid-window schedule generation for system administrators.
-- Windows are assigned in area seniority order using Pacific local time.

create or replace function public.generate_bid_window_schedule(
  requested_bid_year integer,
  requested_area_code text,
  requested_start_date date,
  requested_office_opens time without time zone,
  requested_office_closes time without time zone,
  requested_window_minutes integer,
  requested_blackout_dates date[],
  requested_review_days integer,
  requested_round_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  target_bid_year_id uuid;
  target_area_id uuid;
  target_area_name text;
  blackout_dates date[] := coalesce(requested_blackout_dates, array[]::date[]);
  bidder_row record;
  round_number_value integer;
  review_day_number integer;
  bidder_count integer;
  current_schedule_date date;
  last_scheduled_date date;
  slot_start_time time without time zone;
  start_timestamp timestamptz;
  end_timestamp timestamptz;
  first_window_at timestamptz;
  last_window_at timestamptz;
  round_first_window_at timestamptz;
  round_last_window_at timestamptz;
  window_existed boolean;
  inserted_count integer := 0;
  updated_count integer := 0;
begin
  select b.id
  into actor_profile_id
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and b.active
    and b.role = 'admin'
  limit 1;

  if actor_profile_id is null then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  select bys.id
  into target_bid_year_id
  from public.bid_years bys
  where bys.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % does not exist.', requested_bid_year;
  end if;

  select a.id, a.name
  into target_area_id, target_area_name
  from public.areas a
  where lower(a.code) = lower(trim(requested_area_code));

  if target_area_id is null then
    raise exception 'Area code % does not exist.', requested_area_code;
  end if;

  if requested_start_date is null then
    raise exception 'A Round 1 start date is required.';
  end if;
  if requested_office_opens is null or requested_office_closes is null
    or requested_office_closes <= requested_office_opens then
    raise exception 'Office closing time must be later than opening time.';
  end if;
  if requested_window_minutes is null or requested_window_minutes not between 15 and 480 then
    raise exception 'Bid-window length must be from 15 through 480 minutes.';
  end if;
  if requested_office_opens + make_interval(mins => requested_window_minutes) > requested_office_closes then
    raise exception 'The bid window must fit within one office day.';
  end if;
  if requested_review_days is null or requested_review_days not between 0 and 14 then
    raise exception 'Review days must be from 0 through 14.';
  end if;
  if requested_round_count is null or requested_round_count not between 1 and 6 then
    raise exception 'Round count must be from 1 through 6.';
  end if;
  if cardinality(blackout_dates) > 366 then
    raise exception 'No more than 366 blocked dates may be supplied.';
  end if;

  select count(*)
  into bidder_count
  from public.bidders b
  where b.area_id = target_area_id
    and b.active
    and b.seniority_rank is not null
    and b.bid_role not in ('ADM', 'NB');

  if bidder_count = 0 then
    raise exception 'No active bidding employees exist in %.', target_area_name;
  end if;

  current_schedule_date := requested_start_date;
  while current_schedule_date = any(blackout_dates)
  loop
    current_schedule_date := current_schedule_date + 1;
  end loop;

  for round_number_value in 1..requested_round_count
  loop
    if round_number_value > 1 then
      current_schedule_date := last_scheduled_date + 1;

      for review_day_number in 1..requested_review_days
      loop
        while current_schedule_date = any(blackout_dates)
        loop
          current_schedule_date := current_schedule_date + 1;
        end loop;
        current_schedule_date := current_schedule_date + 1;
      end loop;

      while current_schedule_date = any(blackout_dates)
      loop
        current_schedule_date := current_schedule_date + 1;
      end loop;
    end if;

    slot_start_time := requested_office_opens;
    round_first_window_at := null;
    round_last_window_at := null;

    for bidder_row in
      select b.id, b.seniority_rank
      from public.bidders b
      where b.area_id = target_area_id
        and b.active
        and b.seniority_rank is not null
        and b.bid_role not in ('ADM', 'NB')
      order by b.seniority_rank, b.id
    loop
      if slot_start_time + make_interval(mins => requested_window_minutes) > requested_office_closes then
        current_schedule_date := current_schedule_date + 1;
        while current_schedule_date = any(blackout_dates)
        loop
          current_schedule_date := current_schedule_date + 1;
        end loop;
        slot_start_time := requested_office_opens;
      end if;

      start_timestamp := make_timestamptz(
        extract(year from current_schedule_date)::integer,
        extract(month from current_schedule_date)::integer,
        extract(day from current_schedule_date)::integer,
        extract(hour from slot_start_time)::integer,
        extract(minute from slot_start_time)::integer,
        0,
        'America/Los_Angeles'
      );
      end_timestamp := start_timestamp + make_interval(mins => requested_window_minutes);

      select exists (
        select 1
        from public.bid_windows bw
        where bw.bid_year_id = target_bid_year_id
          and bw.bidder_id = bidder_row.id
          and bw.round_number = round_number_value
      ) into window_existed;

      insert into public.bid_windows (
        bid_year_id,
        bidder_id,
        round_number,
        opens_at,
        closes_at,
        status
      ) values (
        target_bid_year_id,
        bidder_row.id,
        round_number_value,
        start_timestamp,
        end_timestamp,
        'scheduled'
      )
      on conflict (bid_year_id, bidder_id, round_number) do update
      set opens_at = excluded.opens_at,
          closes_at = excluded.closes_at;

      if window_existed then
        updated_count := updated_count + 1;
      else
        inserted_count := inserted_count + 1;
      end if;

      first_window_at := coalesce(first_window_at, start_timestamp);
      last_window_at := end_timestamp;
      round_first_window_at := coalesce(round_first_window_at, start_timestamp);
      round_last_window_at := end_timestamp;
      last_scheduled_date := current_schedule_date;
      slot_start_time := slot_start_time + make_interval(mins => requested_window_minutes);
    end loop;

    insert into public.bid_rounds (
      bid_year_id,
      round_number,
      label,
      starts_at,
      ends_at,
      status
    ) values (
      target_bid_year_id,
      round_number_value,
      format('Round %s', round_number_value),
      round_first_window_at,
      round_last_window_at,
      'scheduled'
    )
    on conflict (bid_year_id, round_number) do update
    set starts_at = excluded.starts_at,
        ends_at = excluded.ends_at;
  end loop;

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    details
  ) values (
    target_bid_year_id,
    target_area_id,
    actor_profile_id,
    'bid_windows.generated',
    'bid_windows',
    jsonb_build_object(
      'area_code', requested_area_code,
      'bid_year', requested_bid_year,
      'start_date', requested_start_date,
      'office_opens', requested_office_opens,
      'office_closes', requested_office_closes,
      'window_minutes', requested_window_minutes,
      'review_days', requested_review_days,
      'round_count', requested_round_count,
      'blackout_dates', blackout_dates,
      'bidders_processed', bidder_count,
      'windows_inserted', inserted_count,
      'windows_updated', updated_count
    )
  );

  return jsonb_build_object(
    'bidders_processed', bidder_count,
    'windows_inserted', inserted_count,
    'windows_updated', updated_count,
    'windows_processed', inserted_count + updated_count,
    'first_window_at', first_window_at,
    'last_window_at', last_window_at
  );
end;
$$;

revoke execute on function public.generate_bid_window_schedule(integer, text, date, time without time zone, time without time zone, integer, date[], integer, integer) from public, anon;
grant execute on function public.generate_bid_window_schedule(integer, text, date, time without time zone, time without time zone, integer, date[], integer, integer) to authenticated;

comment on function public.generate_bid_window_schedule(integer, text, date, time without time zone, time without time zone, integer, date[], integer, integer) is
  'Generates and atomically upserts an area bid-window schedule in seniority order while respecting office hours, window length, review days, and blocked dates.';
