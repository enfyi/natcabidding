-- Secure, atomic bid-time imports for system administrators.
-- Each populated round start creates or updates one two-hour bid window. Omitted
-- bidders and blank round values remain unchanged, and existing status is preserved.

create or replace function private.bidder_id_for_admin_bid_time_import(
  requested_area_id uuid,
  requested_rank integer,
  requested_initials text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.bidders b
  where private.is_current_admin()
    and b.area_id = requested_area_id
    and b.active
    and b.seniority_rank = requested_rank
    and (
      nullif(trim(requested_initials), '') is null
      or upper(trim(coalesce(b.initials, ''))) = upper(trim(requested_initials))
    )
  limit 1;
$$;

revoke execute on function private.bidder_id_for_admin_bid_time_import(uuid, integer, text) from public, anon;
grant execute on function private.bidder_id_for_admin_bid_time_import(uuid, integer, text) to authenticated;

create or replace function private.upsert_admin_bid_window(
  requested_bid_year_id uuid,
  requested_bidder_id uuid,
  requested_round integer,
  requested_start timestamptz,
  requested_end timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  already_exists boolean;
begin
  if not private.is_current_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if requested_round not between 1 and 4 or requested_end <= requested_start then
    raise exception 'Invalid bid-window values.';
  end if;
  if not exists (
    select 1
    from public.bidders b
    where b.id = requested_bidder_id and b.active
  ) then
    raise exception 'The target bidder is not active.';
  end if;

  select exists (
    select 1
    from public.bid_windows bw
    where bw.bid_year_id = requested_bid_year_id
      and bw.bidder_id = requested_bidder_id
      and bw.round_number = requested_round
  ) into already_exists;

  insert into public.bid_windows (
    bid_year_id,
    bidder_id,
    round_number,
    opens_at,
    closes_at,
    status
  ) values (
    requested_bid_year_id,
    requested_bidder_id,
    requested_round,
    requested_start,
    requested_end,
    'scheduled'
  )
  on conflict (bid_year_id, bidder_id, round_number) do update
  set opens_at = excluded.opens_at,
      closes_at = excluded.closes_at;

  return already_exists;
end;
$$;

revoke execute on function private.upsert_admin_bid_window(uuid, uuid, integer, timestamptz, timestamptz) from public, anon;
grant execute on function private.upsert_admin_bid_window(uuid, uuid, integer, timestamptz, timestamptz) to authenticated;

create or replace function private.record_admin_bid_time_import(
  requested_bid_year_id uuid,
  requested_area_id uuid,
  requested_actor_id uuid,
  requested_area_code text,
  requested_bid_year integer,
  requested_bidder_count integer,
  requested_inserted_count integer,
  requested_updated_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_current_admin() or requested_actor_id <> private.current_admin_profile_id() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    details
  ) values (
    requested_bid_year_id,
    requested_area_id,
    requested_actor_id,
    'bid_times.imported',
    'bid_windows',
    jsonb_build_object(
      'area_code', requested_area_code,
      'bid_year', requested_bid_year,
      'mode', 'upsert',
      'bidders_processed', requested_bidder_count,
      'windows_inserted', requested_inserted_count,
      'windows_updated', requested_updated_count
    )
  );
end;
$$;

revoke execute on function private.record_admin_bid_time_import(uuid, uuid, uuid, text, integer, integer, integer, integer) from public, anon;
grant execute on function private.record_admin_bid_time_import(uuid, uuid, uuid, text, integer, integer, integer, integer) to authenticated;

create or replace function public.import_bid_time_schedule(
  requested_bid_year integer,
  requested_area_code text,
  requested_bidders jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  target_bid_year_id uuid;
  target_area_id uuid;
  bidder_item jsonb;
  target_bidder_id uuid;
  rank_value integer;
  initials_value text;
  round_values jsonb;
  start_value text;
  start_timestamp timestamptz;
  end_timestamp timestamptz;
  window_existed boolean;
  imported_ranks integer[] := array[]::integer[];
  row_number integer := 0;
  round_number_value integer;
  bidder_window_count integer;
  inserted_count integer := 0;
  updated_count integer := 0;
begin
  if not (select public.is_current_admin()) then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  actor_profile_id := private.current_admin_profile_id();

  select bys.id
  into target_bid_year_id
  from public.bid_years bys
  where bys.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % does not exist.', requested_bid_year;
  end if;

  select a.id
  into target_area_id
  from public.areas a
  where lower(a.code) = lower(trim(requested_area_code));

  if target_area_id is null then
    raise exception 'Area code % does not exist.', requested_area_code;
  end if;

  if jsonb_typeof(requested_bidders) <> 'array' then
    raise exception 'The imported bid-time payload must be a JSON array.';
  end if;

  if jsonb_array_length(requested_bidders) < 1 or jsonb_array_length(requested_bidders) > 500 then
    raise exception 'Import between 1 and 500 bidder rows at a time.';
  end if;

  for bidder_item in select value from jsonb_array_elements(requested_bidders)
  loop
    row_number := row_number + 1;

    if coalesce(bidder_item ->> 'seniority_rank', '') !~ '^\d{1,4}$' then
      raise exception 'Row % has an invalid seniority_rank.', row_number;
    end if;

    rank_value := (bidder_item ->> 'seniority_rank')::integer;
    initials_value := upper(trim(coalesce(bidder_item ->> 'initials', '')));
    round_values := bidder_item -> 'round_starts';

    if rank_value < 1 or rank_value > 1000 then
      raise exception 'Row % seniority_rank must be between 1 and 1000.', row_number;
    end if;
    if rank_value = any(imported_ranks) then
      raise exception 'Seniority rank % appears more than once in the import.', rank_value;
    end if;
    if length(initials_value) > 12 then
      raise exception 'Row % initials must be 12 characters or fewer.', row_number;
    end if;
    if jsonb_typeof(round_values) <> 'array' or jsonb_array_length(round_values) <> 4 then
      raise exception 'Row % must contain exactly four round values.', row_number;
    end if;

    target_bidder_id := private.bidder_id_for_admin_bid_time_import(target_area_id, rank_value, initials_value);

    if target_bidder_id is null then
      raise exception 'No active bidder matching seniority rank % and the supplied initials exists in area %.', rank_value, requested_area_code;
    end if;

    imported_ranks := array_append(imported_ranks, rank_value);
    bidder_window_count := 0;

    for round_number_value in 1..4
    loop
      start_value := nullif(trim(round_values ->> (round_number_value - 1)), '');
      if start_value is null then
        continue;
      end if;
      if start_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
        raise exception 'Row % Round % has an invalid start time.', row_number, round_number_value;
      end if;

      begin
        start_timestamp := make_timestamptz(
          substring(start_value from 1 for 4)::integer,
          substring(start_value from 6 for 2)::integer,
          substring(start_value from 9 for 2)::integer,
          substring(start_value from 12 for 2)::integer,
          substring(start_value from 15 for 2)::integer,
          0,
          'America/Los_Angeles'
        );
      exception when others then
        raise exception 'Row % Round % has an invalid calendar date or time.', row_number, round_number_value;
      end;

      end_timestamp := start_timestamp + interval '2 hours';
      bidder_window_count := bidder_window_count + 1;

      window_existed := private.upsert_admin_bid_window(
        target_bid_year_id,
        target_bidder_id,
        round_number_value,
        start_timestamp,
        end_timestamp
      );

      if window_existed then
        updated_count := updated_count + 1;
      else
        inserted_count := inserted_count + 1;
      end if;
    end loop;

    if bidder_window_count = 0 then
      raise exception 'Row % must include at least one round start time.', row_number;
    end if;
  end loop;

  perform private.record_admin_bid_time_import(
    target_bid_year_id,
    target_area_id,
    actor_profile_id,
    requested_area_code,
    requested_bid_year,
    jsonb_array_length(requested_bidders),
    inserted_count,
    updated_count
  );

  return jsonb_build_object(
    'bidders_processed', jsonb_array_length(requested_bidders),
    'windows_inserted', inserted_count,
    'windows_updated', updated_count,
    'windows_processed', inserted_count + updated_count
  );
end;
$$;

revoke execute on function public.import_bid_time_schedule(integer, text, jsonb) from public, anon;
grant execute on function public.import_bid_time_schedule(integer, text, jsonb) to authenticated;

comment on function public.import_bid_time_schedule(integer, text, jsonb) is
  'Atomically adds or updates selected two-hour bid windows for one area and bid year. Blank rounds and omitted bidders remain unchanged.';
