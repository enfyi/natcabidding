-- Full administrator bid-line editor with persisted per-area ordering.

alter table public.rdo_lines
  add column if not exists display_order integer;

with ranked as (
  select id,
    row_number() over (
      partition by bid_year_id, area_id
      order by
        case when line_code ~ '^\d+$' then 0 else 1 end,
        case when line_code ~ '^\d+$' then line_code::integer end,
        line_code,
        id
    ) * 10 as next_order
  from public.rdo_lines
)
update public.rdo_lines line
set display_order = ranked.next_order
from ranked
where ranked.id = line.id
  and line.display_order is null;

alter table public.rdo_lines
  alter column display_order set default 0,
  alter column display_order set not null;

create index if not exists rdo_lines_area_display_order_idx
  on public.rdo_lines(bid_year_id, area_id, display_order, line_code);

create or replace function private.assign_rdo_line_display_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_order = 0 then
    select coalesce(max(line.display_order), 0) + 10
    into new.display_order
    from public.rdo_lines line
    where line.bid_year_id = new.bid_year_id
      and line.area_id = new.area_id;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_rdo_line_display_order on public.rdo_lines;
create trigger assign_rdo_line_display_order
before insert on public.rdo_lines
for each row execute function private.assign_rdo_line_display_order();

create or replace function private.admin_save_bid_line_impl(
  target_line_id uuid,
  requested_bid_year integer,
  requested_area_code text,
  requested_line jsonb
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
  existing_line public.rdo_lines%rowtype;
  saved_line public.rdo_lines%rowtype;
  line_days jsonb;
  line_code_value text;
  line_type_value text;
  pattern_value text;
  fatigue_group_value text;
  mid_value text;
  weekday_number integer;
  shift_value text;
  next_display_order integer;
  action_name text;
begin
  if not (select public.is_current_admin()) then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  actor_profile_id := private.current_admin_profile_id();

  select id into target_bid_year_id
  from public.bid_years
  where bid_year = requested_bid_year;
  if target_bid_year_id is null then
    raise exception 'Bid year % does not exist.', requested_bid_year;
  end if;

  select id into target_area_id
  from public.areas
  where lower(code) = lower(trim(requested_area_code));
  if target_area_id is null then
    raise exception 'Area code % does not exist.', requested_area_code;
  end if;

  if jsonb_typeof(requested_line) <> 'object' then
    raise exception 'A bid-line record is required.';
  end if;

  line_code_value := trim(requested_line ->> 'line_code');
  line_type_value := upper(trim(coalesce(requested_line ->> 'line_type', '')));
  pattern_value := upper(trim(requested_line ->> 'pattern'));
  fatigue_group_value := nullif(trim(coalesce(requested_line ->> 'fatigue_group', '')), '');
  mid_value := case upper(trim(coalesce(requested_line ->> 'mid', 'NO')))
    when 'NO' then 'No'
    when 'BID' then 'BID'
    else null
  end;
  line_days := requested_line -> 'days';

  if line_code_value is null or line_code_value = '' or length(line_code_value) > 40 then
    raise exception 'Line code is required and must be 40 characters or fewer.';
  end if;
  if line_type_value not in ('CPC', 'DEV') then
    raise exception 'Line section must be CPC, R-DEV, or D-DEV.';
  end if;
  if pattern_value is null or pattern_value = '' or length(pattern_value) > 40 then
    raise exception 'Pattern is required and must be 40 characters or fewer.';
  end if;
  if line_type_value = 'DEV' and pattern_value not in ('R-DEV', 'D-DEV') then
    raise exception 'Development lines must be designated R-DEV or D-DEV.';
  end if;
  if fatigue_group_value is not null and fatigue_group_value not in ('A', 'B', 'C', 'C only', 'B only') then
    raise exception 'Fatigue group must be A, B, C, C only, or B only.';
  end if;
  if mid_value is null then
    raise exception 'Mid must be No or BID.';
  end if;
  if jsonb_typeof(requested_line -> 'aws') is distinct from 'boolean'
    or jsonb_typeof(requested_line -> 'four_ten') is distinct from 'boolean'
    or jsonb_typeof(requested_line -> 'flex') is distinct from 'boolean' then
    raise exception 'AWS, 4/10, and Flex must be Yes or No.';
  end if;
  if jsonb_typeof(line_days) <> 'array' or jsonb_array_length(line_days) <> 7 then
    raise exception 'Enter exactly seven shift or RDO values, Sunday through Saturday.';
  end if;

  for weekday_number in 0..6 loop
    shift_value := upper(trim(line_days ->> weekday_number));
    if shift_value is null or shift_value = '' or length(shift_value) > 20 then
      raise exception 'Each day must contain a shift start time or RDO.';
    end if;
  end loop;

  if target_line_id is null then
    select coalesce(max(display_order), 0) + 10 into next_display_order
    from public.rdo_lines
    where bid_year_id = target_bid_year_id and area_id = target_area_id;

    insert into public.rdo_lines (
      bid_year_id, area_id, line_code, display_order, line_type, pattern,
      fatigue_group, mid, aws, four_ten, flex, status
    ) values (
      target_bid_year_id, target_area_id, line_code_value, next_display_order,
      line_type_value, pattern_value, coalesce(fatigue_group_value, 'C'), mid_value,
      (requested_line ->> 'aws')::boolean,
      (requested_line ->> 'four_ten')::boolean,
      (requested_line ->> 'flex')::boolean,
      'open'
    ) returning * into saved_line;
    action_name := 'created';
  else
    select * into existing_line
    from public.rdo_lines
    where id = target_line_id
    for update;
    if not found then
      raise exception 'The selected bid line no longer exists.';
    end if;
    if existing_line.bid_year_id <> target_bid_year_id then
      raise exception 'A bid line cannot be moved to a different bid year.';
    end if;
    if (existing_line.area_id <> target_area_id or existing_line.line_code <> line_code_value)
      and (existing_line.status <> 'open' or existing_line.assigned_bidder_id is not null) then
      raise exception 'Assigned, taken, or locked lines cannot change area or line code.';
    end if;

    if existing_line.area_id <> target_area_id then
      select coalesce(max(display_order), 0) + 10 into next_display_order
      from public.rdo_lines
      where bid_year_id = target_bid_year_id and area_id = target_area_id;
    else
      next_display_order := existing_line.display_order;
    end if;

    update public.rdo_lines
    set area_id = target_area_id,
        line_code = line_code_value,
        display_order = next_display_order,
        line_type = line_type_value,
        pattern = pattern_value,
        fatigue_group = coalesce(fatigue_group_value, 'C'),
        mid = mid_value,
        aws = (requested_line ->> 'aws')::boolean,
        four_ten = (requested_line ->> 'four_ten')::boolean,
        flex = (requested_line ->> 'flex')::boolean,
        updated_at = now()
    where id = target_line_id
    returning * into saved_line;
    action_name := 'updated';
  end if;

  for weekday_number in 0..6 loop
    shift_value := upper(trim(line_days ->> weekday_number));
    insert into public.rdo_line_days (rdo_line_id, weekday, shift_code)
    values (saved_line.id, weekday_number, shift_value)
    on conflict (rdo_line_id, weekday) do update
    set shift_code = excluded.shift_code;
  end loop;

  insert into public.audit_events (
    bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details
  ) values (
    saved_line.bid_year_id, saved_line.area_id, actor_profile_id,
    'bid_line.' || action_name, 'rdo_lines', saved_line.id,
    jsonb_build_object(
      'line_code', saved_line.line_code,
      'line_type', saved_line.line_type,
      'pattern', saved_line.pattern,
      'mid', saved_line.mid,
      'days', line_days
    )
  );

  return jsonb_build_object('id', saved_line.id, 'line_code', saved_line.line_code, 'action', action_name);
exception
  when unique_violation then
    raise exception 'Line code % already exists in that area for %.', line_code_value, requested_bid_year;
end;
$$;

revoke execute on function private.admin_save_bid_line_impl(uuid, integer, text, jsonb) from public, anon;
grant execute on function private.admin_save_bid_line_impl(uuid, integer, text, jsonb) to authenticated;

create or replace function public.admin_save_bid_line(
  target_line_id uuid,
  requested_bid_year integer,
  requested_area_code text,
  requested_line jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_save_bid_line_impl(target_line_id, requested_bid_year, requested_area_code, requested_line);
$$;

revoke execute on function public.admin_save_bid_line(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.admin_save_bid_line(uuid, integer, text, jsonb) to authenticated;

create or replace function private.admin_reorder_bid_lines_impl(
  requested_bid_year integer,
  requested_area_code text,
  ordered_line_ids jsonb
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
  expected_count integer;
  supplied_count integer;
begin
  if not (select public.is_current_admin()) then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(ordered_line_ids) <> 'array' then
    raise exception 'The ordered line IDs must be an array.';
  end if;

  actor_profile_id := private.current_admin_profile_id();
  select id into target_bid_year_id from public.bid_years where bid_year = requested_bid_year;
  select id into target_area_id from public.areas where lower(code) = lower(trim(requested_area_code));
  if target_bid_year_id is null or target_area_id is null then
    raise exception 'The selected bid year or area does not exist.';
  end if;

  select count(*) into expected_count
  from public.rdo_lines
  where bid_year_id = target_bid_year_id and area_id = target_area_id;
  select count(distinct value) into supplied_count from jsonb_array_elements_text(ordered_line_ids);

  if supplied_count <> expected_count or jsonb_array_length(ordered_line_ids) <> expected_count then
    raise exception 'The line list changed. Reload it before reordering.';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(ordered_line_ids) item
    where not exists (
      select 1 from public.rdo_lines line
      where line.id = item.value::uuid
        and line.bid_year_id = target_bid_year_id
        and line.area_id = target_area_id
    )
  ) then
    raise exception 'The order contains a line outside the selected bid year or area.';
  end if;

  update public.rdo_lines line
  set display_order = ordered.ordinality::integer * 10,
      updated_at = now()
  from jsonb_array_elements_text(ordered_line_ids) with ordinality ordered(id, ordinality)
  where line.id = ordered.id::uuid;

  insert into public.audit_events (
    bid_year_id, area_id, actor_id, event_type, entity_table, details
  ) values (
    target_bid_year_id, target_area_id, actor_profile_id,
    'bid_lines.reordered', 'rdo_lines',
    jsonb_build_object('line_ids', ordered_line_ids)
  );

  return jsonb_build_object('reordered', expected_count);
end;
$$;

revoke execute on function private.admin_reorder_bid_lines_impl(integer, text, jsonb) from public, anon;
grant execute on function private.admin_reorder_bid_lines_impl(integer, text, jsonb) to authenticated;

create or replace function public.admin_reorder_bid_lines(
  requested_bid_year integer,
  requested_area_code text,
  ordered_line_ids jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_reorder_bid_lines_impl(requested_bid_year, requested_area_code, ordered_line_ids);
$$;

revoke execute on function public.admin_reorder_bid_lines(integer, text, jsonb) from public, anon;
grant execute on function public.admin_reorder_bid_lines(integer, text, jsonb) to authenticated;

comment on function public.admin_save_bid_line(uuid, integer, text, jsonb) is
  'Creates or edits one bid line and its seven-day schedule for a system administrator.';
comment on function public.admin_reorder_bid_lines(integer, text, jsonb) is
  'Persists the display order of every bid line in one bid year and area.';
