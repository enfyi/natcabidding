-- Atomic all-area bid-window schedule generation for system administrators.
-- Every area starts each round together; the largest roster determines the next round's start.

create or replace function public.generate_consistent_bid_window_schedules(
  requested_bid_year integer,
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
  blackout_dates date[] := coalesce(requested_blackout_dates, array[]::date[]);
  area_row record;
  bidder_row record;
  round_number_value integer;
  review_day_number integer;
  area_count integer;
  bidder_count integer;
  largest_area_name text;
  largest_area_bidder_count integer;
  shared_round_start_date date;
  area_schedule_date date;
  round_last_scheduled_date date;
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

  select count(*), coalesce(sum(area_totals.bidder_count), 0)
  into area_count, bidder_count
  from (
    select a.id, count(b.id)::integer as bidder_count
    from public.areas a
    join public.bidders b
      on b.area_id = a.id
      and b.active
      and b.seniority_rank is not null
      and b.bid_role not in ('ADM', 'NB')
    group by a.id
  ) area_totals;

  if bidder_count = 0 then
    raise exception 'No active bidding employees exist.';
  end if;

  select area_totals.area_name, area_totals.bidder_count
  into largest_area_name, largest_area_bidder_count
  from (
    select a.name as area_name, a.display_order, count(b.id)::integer as bidder_count
    from public.areas a
    join public.bidders b
      on b.area_id = a.id
      and b.active
      and b.seniority_rank is not null
      and b.bid_role not in ('ADM', 'NB')
    group by a.id, a.name, a.display_order
  ) area_totals
  order by area_totals.bidder_count desc, area_totals.display_order, area_totals.area_name
  limit 1;

  shared_round_start_date := requested_start_date;
  while shared_round_start_date = any(blackout_dates)
  loop
    shared_round_start_date := shared_round_start_date + 1;
  end loop;

  for round_number_value in 1..requested_round_count
  loop
    round_first_window_at := null;
    round_last_window_at := null;
    round_last_scheduled_date := shared_round_start_date;

    for area_row in
      select a.id, a.code, a.name
      from public.areas a
      where exists (
        select 1
        from public.bidders b
        where b.area_id = a.id
          and b.active
          and b.seniority_rank is not null
          and b.bid_role not in ('ADM', 'NB')
      )
      order by a.display_order, a.name
    loop
      area_schedule_date := shared_round_start_date;
      slot_start_time := requested_office_opens;

      for bidder_row in
        select b.id
        from public.bidders b
        where b.area_id = area_row.id
          and b.active
          and b.seniority_rank is not null
          and b.bid_role not in ('ADM', 'NB')
        order by b.seniority_rank, b.id
      loop
        if slot_start_time + make_interval(mins => requested_window_minutes) > requested_office_closes then
          area_schedule_date := area_schedule_date + 1;
          while area_schedule_date = any(blackout_dates)
          loop
            area_schedule_date := area_schedule_date + 1;
          end loop;
          slot_start_time := requested_office_opens;
        end if;

        start_timestamp := make_timestamptz(
          extract(year from area_schedule_date)::integer,
          extract(month from area_schedule_date)::integer,
          extract(day from area_schedule_date)::integer,
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
        if last_window_at is null or end_timestamp > last_window_at then
          last_window_at := end_timestamp;
        end if;
        round_first_window_at := coalesce(round_first_window_at, start_timestamp);
        if round_last_window_at is null or end_timestamp > round_last_window_at then
          round_last_window_at := end_timestamp;
        end if;
        if area_schedule_date > round_last_scheduled_date then
          round_last_scheduled_date := area_schedule_date;
        end if;
        slot_start_time := slot_start_time + make_interval(mins => requested_window_minutes);
      end loop;
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

    if round_number_value < requested_round_count then
      shared_round_start_date := round_last_scheduled_date + 1;

      for review_day_number in 1..requested_review_days
      loop
        while shared_round_start_date = any(blackout_dates)
        loop
          shared_round_start_date := shared_round_start_date + 1;
        end loop;
        shared_round_start_date := shared_round_start_date + 1;
      end loop;

      while shared_round_start_date = any(blackout_dates)
      loop
        shared_round_start_date := shared_round_start_date + 1;
      end loop;
    end if;
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
    null,
    actor_profile_id,
    'bid_windows.generated_all_areas',
    'bid_windows',
    jsonb_build_object(
      'bid_year', requested_bid_year,
      'start_date', requested_start_date,
      'office_opens', requested_office_opens,
      'office_closes', requested_office_closes,
      'window_minutes', requested_window_minutes,
      'review_days', requested_review_days,
      'round_count', requested_round_count,
      'blackout_dates', blackout_dates,
      'areas_processed', area_count,
      'largest_area', largest_area_name,
      'largest_area_bidders', largest_area_bidder_count,
      'bidders_processed', bidder_count,
      'windows_inserted', inserted_count,
      'windows_updated', updated_count
    )
  );

  return jsonb_build_object(
    'areas_processed', area_count,
    'largest_area', largest_area_name,
    'largest_area_bidders', largest_area_bidder_count,
    'bidders_processed', bidder_count,
    'windows_inserted', inserted_count,
    'windows_updated', updated_count,
    'windows_processed', inserted_count + updated_count,
    'first_window_at', first_window_at,
    'last_window_at', last_window_at
  );
end;
$$;

revoke execute on function public.generate_consistent_bid_window_schedules(integer, date, time without time zone, time without time zone, integer, date[], integer, integer) from public, anon;
grant execute on function public.generate_consistent_bid_window_schedules(integer, date, time without time zone, time without time zone, integer, date[], integer, integer) to authenticated;

comment on function public.generate_consistent_bid_window_schedules(integer, date, time without time zone, time without time zone, integer, date[], integer, integer) is
  'Generates and atomically upserts synchronized bid-window schedules for all active bidding areas, using the largest roster to determine round spacing.';
