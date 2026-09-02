-- Secure, atomic RDO bid-line schedule imports for system administrators.
-- The importer updates line definitions and seven weekday rows while preserving
-- existing bidder assignments and line status.

create schema if not exists private;

create or replace function private.current_admin_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and b.active
    and b.role = 'admin'
  limit 1;
$$;

revoke execute on function private.current_admin_profile_id() from public, anon;
grant execute on function private.current_admin_profile_id() to authenticated;

create or replace function private.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_admin_profile_id() is not null;
$$;

revoke execute on function private.is_current_admin() from public, anon;
grant execute on function private.is_current_admin() to authenticated;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_current_admin();
$$;

revoke execute on function public.is_current_admin() from public, anon;
grant execute on function public.is_current_admin() to authenticated;

grant insert, update on public.rdo_lines to authenticated;
grant insert, update on public.rdo_line_days to authenticated;
grant insert on public.audit_events to authenticated;

create or replace function public.import_bid_line_schedule(
  requested_bid_year integer,
  requested_area_code text,
  requested_lines jsonb
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
  line_item jsonb;
  line_days jsonb;
  line_id uuid;
  line_code_value text;
  line_type_value text;
  pattern_value text;
  fatigue_group_value text;
  mid_value text;
  aws_value boolean;
  four_ten_value boolean;
  flex_value boolean;
  shift_value text;
  imported_codes text[] := array[]::text[];
  row_number integer := 0;
  weekday_number integer;
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

  if jsonb_typeof(requested_lines) <> 'array' then
    raise exception 'The imported lines payload must be a JSON array.';
  end if;

  if jsonb_array_length(requested_lines) < 1 or jsonb_array_length(requested_lines) > 500 then
    raise exception 'Import between 1 and 500 bid lines at a time.';
  end if;

  for line_item in select value from jsonb_array_elements(requested_lines)
  loop
    row_number := row_number + 1;
    line_code_value := trim(line_item ->> 'line_code');
    line_type_value := upper(trim(coalesce(line_item ->> 'line_type', 'CPC')));
    pattern_value := trim(line_item ->> 'pattern');
    fatigue_group_value := case lower(trim(coalesce(line_item ->> 'fatigue_group', 'C')))
      when 'a' then 'A'
      when 'b' then 'B'
      when 'c' then 'C'
      when 'c only' then 'C only'
      else null
    end;
    mid_value := case upper(trim(coalesce(line_item ->> 'mid', 'No')))
      when 'NO' then 'No'
      when 'BID' then 'BID'
      else null
    end;
    line_days := line_item -> 'days';

    if line_code_value is null or line_code_value = '' or length(line_code_value) > 40 then
      raise exception 'Row % has an invalid line_code.', row_number;
    end if;
    if line_code_value = any(imported_codes) then
      raise exception 'Line code % appears more than once in the import.', line_code_value;
    end if;
    if line_type_value not in ('CPC', 'DEV') then
      raise exception 'Row % line_type must be CPC or DEV.', row_number;
    end if;
    if pattern_value is null or pattern_value = '' or length(pattern_value) > 40 then
      raise exception 'Row % has an invalid pattern.', row_number;
    end if;
    if fatigue_group_value is null then
      raise exception 'Row % fatigue_group must be A, B, C, or C only.', row_number;
    end if;
    if mid_value is null then
      raise exception 'Row % mid must be No or BID.', row_number;
    end if;
    if jsonb_typeof(line_item -> 'aws') <> 'boolean'
      or jsonb_typeof(line_item -> 'four_ten') <> 'boolean'
      or jsonb_typeof(line_item -> 'flex') <> 'boolean' then
      raise exception 'Row % AWS, four_ten, and flex values must be booleans.', row_number;
    end if;
    if jsonb_typeof(line_days) <> 'array' or jsonb_array_length(line_days) <> 7 then
      raise exception 'Row % must contain exactly seven day values, Sunday through Saturday.', row_number;
    end if;

    aws_value := (line_item ->> 'aws')::boolean;
    four_ten_value := (line_item ->> 'four_ten')::boolean;
    flex_value := (line_item ->> 'flex')::boolean;
    imported_codes := array_append(imported_codes, line_code_value);

    select rl.id
    into line_id
    from public.rdo_lines rl
    where rl.bid_year_id = target_bid_year_id
      and rl.area_id = target_area_id
      and rl.line_code = line_code_value;

    if line_id is null then
      insert into public.rdo_lines (
        bid_year_id,
        area_id,
        line_code,
        line_type,
        pattern,
        fatigue_group,
        mid,
        aws,
        four_ten,
        flex,
        status
      ) values (
        target_bid_year_id,
        target_area_id,
        line_code_value,
        line_type_value,
        pattern_value,
        fatigue_group_value,
        mid_value,
        aws_value,
        four_ten_value,
        flex_value,
        'open'
      )
      returning id into line_id;
      inserted_count := inserted_count + 1;
    else
      update public.rdo_lines rl
      set line_type = line_type_value,
          pattern = pattern_value,
          fatigue_group = fatigue_group_value,
          mid = mid_value,
          aws = aws_value,
          four_ten = four_ten_value,
          flex = flex_value,
          updated_at = now()
      where rl.id = line_id;
      updated_count := updated_count + 1;
    end if;

    for weekday_number in 0..6
    loop
      shift_value := trim(line_days ->> weekday_number);
      if shift_value is null or shift_value = '' or length(shift_value) > 20 then
        raise exception 'Row % has an invalid shift value for weekday %.', row_number, weekday_number;
      end if;

      insert into public.rdo_line_days (rdo_line_id, weekday, shift_code)
      values (line_id, weekday_number, shift_value)
      on conflict (rdo_line_id, weekday) do update
      set shift_code = excluded.shift_code;
    end loop;
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
    'bid_lines.imported',
    'rdo_lines',
    jsonb_build_object(
      'area_code', requested_area_code,
      'bid_year', requested_bid_year,
      'mode', 'upsert',
      'inserted', inserted_count,
      'updated', updated_count
    )
  );

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'processed', inserted_count + updated_count
  );
end;
$$;

revoke execute on function public.import_bid_line_schedule(integer, text, jsonb) from public, anon;
grant execute on function public.import_bid_line_schedule(integer, text, jsonb) to authenticated;

comment on function public.import_bid_line_schedule(integer, text, jsonb) is
  'Atomically imports an area bid-line schedule for an authenticated system administrator while preserving assignments and line status.';
