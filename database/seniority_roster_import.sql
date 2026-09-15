-- Secure, atomic seniority-roster imports for system administrators.
-- Existing bidders are matched by profile ID or initials so related auth, bid,
-- leave, and schedule records remain attached to the same bidder ID.

alter table public.bidders
  add column if not exists seniority_date date;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.import_seniority_roster_impl(requested_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  roster_item jsonb;
  target_profile_id uuid;
  requested_profile_id uuid;
  target_area_id uuid;
  area_code_value text;
  rank_value integer;
  first_name_value text;
  last_name_value text;
  initials_value text;
  email_value text;
  phone_value text;
  bid_role_value text;
  seniority_date_value date;
  active_value boolean;
  matching_count integer;
  row_number integer := 0;
  row_index integer;
  target_ids uuid[] := array[]::uuid[];
  changed_rows boolean[] := array[]::boolean[];
  imported_target_ids uuid[] := array[]::uuid[];
  added_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  row_changed boolean;
  current_bidder public.bidders%rowtype;
begin
  select b.id into actor_profile_id
  from public.bidders b
  where b.auth_user_id = auth.uid() and b.active and b.role = 'admin'
  limit 1;

  if actor_profile_id is null then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('zla_seniority_roster_import'));
  if jsonb_typeof(requested_rows) <> 'array' then
    raise exception 'The imported roster payload must be a JSON array.';
  end if;
  if jsonb_array_length(requested_rows) < 1 or jsonb_array_length(requested_rows) > 500 then
    raise exception 'Import between 1 and 500 roster rows at a time.';
  end if;

  -- Resolve and validate every bidder before applying field updates. Existing
  -- ranks are temporarily cleared so rank swaps can happen in one transaction.
  for roster_item in select value from jsonb_array_elements(requested_rows)
  loop
    row_number := row_number + 1;
    area_code_value := upper(trim(coalesce(roster_item ->> 'area_code', '')));
    first_name_value := trim(coalesce(roster_item ->> 'first_name', ''));
    last_name_value := trim(coalesce(roster_item ->> 'last_name', ''));
    initials_value := upper(trim(coalesce(roster_item ->> 'initials', '')));
    email_value := lower(nullif(trim(coalesce(roster_item ->> 'email', '')), ''));
    phone_value := nullif(trim(coalesce(roster_item ->> 'phone', '')), '');
    bid_role_value := upper(trim(coalesce(roster_item ->> 'bid_role', '')));
    active_value := coalesce((roster_item ->> 'active')::boolean, true);

    if coalesce(roster_item ->> 'seniority_rank', '') !~ '^\d{1,4}$' then
      raise exception 'Row % has an invalid seniority_rank.', row_number;
    end if;
    rank_value := (roster_item ->> 'seniority_rank')::integer;
    if rank_value < 1 or rank_value > 1000 then raise exception 'Row % seniority_rank must be between 1 and 1000.', row_number; end if;
    if first_name_value = '' or last_name_value = '' or initials_value = '' then raise exception 'Row % requires first_name, last_name, and initials.', row_number; end if;
    if length(initials_value) > 12 then raise exception 'Row % initials must be 12 characters or fewer.', row_number; end if;
    if bid_role_value not in ('CPC', 'GL', 'R-DEV', 'D-DEV', 'TMC', 'DEV') then raise exception 'Row % has an invalid bid_role.', row_number; end if;
    if (area_code_value = 'TMU' and bid_role_value not in ('TMC', 'DEV'))
      or (area_code_value <> 'TMU' and bid_role_value in ('TMC', 'DEV')) then
      raise exception 'Row % bid_role is not valid for area %.', row_number, area_code_value;
    end if;

    select a.id into target_area_id from public.areas a where upper(a.code) = area_code_value;
    if target_area_id is null then raise exception 'Row % area code % does not exist.', row_number, area_code_value; end if;

    requested_profile_id := null;
    if nullif(trim(coalesce(roster_item ->> 'profile_id', '')), '') is not null then
      begin
        requested_profile_id := (roster_item ->> 'profile_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Row % has an invalid profile_id.', row_number;
      end;
    end if;

    target_profile_id := null;
    if requested_profile_id is not null then
      select b.id into target_profile_id from public.bidders b where b.id = requested_profile_id and b.bid_role <> 'ADM';
      if target_profile_id is null then raise exception 'Row % profile_id does not identify a rostered bidder.', row_number; end if;
    else
      select count(*), min(b.id::text)::uuid into matching_count, target_profile_id
      from public.bidders b
      where b.bid_role <> 'ADM' and upper(trim(coalesce(b.initials, ''))) = initials_value;
      if matching_count > 1 then raise exception 'Row % initials % match more than one bidder; add profile_id to identify the correct person.', row_number, initials_value; end if;
    end if;

    if target_profile_id is not null and target_profile_id = any(imported_target_ids) then raise exception 'Row % identifies a bidder already included earlier in this import.', row_number; end if;
    if exists (select 1 from public.bidders b where b.id is distinct from target_profile_id and b.bid_role <> 'ADM' and upper(trim(coalesce(b.initials, ''))) = initials_value) then
      raise exception 'Row % initials % are already assigned to another bidder.', row_number, initials_value;
    end if;
    if email_value is not null and active_value and exists (select 1 from public.bidders b where b.id is distinct from target_profile_id and b.active and lower(b.email) = email_value) then
      raise exception 'Row % email % is already assigned to another active bidder.', row_number, email_value;
    end if;

    seniority_date_value := null;
    if nullif(trim(coalesce(roster_item ->> 'seniority_date', '')), '') is not null then
      begin
        seniority_date_value := (roster_item ->> 'seniority_date')::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception 'Row % has an invalid seniority_date.', row_number;
      end;
    end if;

    row_changed := true;
    if target_profile_id is not null then
      select * into strict current_bidder from public.bidders b where b.id = target_profile_id;
      row_changed := current_bidder.area_id is distinct from target_area_id
        or current_bidder.seniority_rank is distinct from rank_value
        or current_bidder.first_name is distinct from first_name_value
        or current_bidder.last_name is distinct from last_name_value
        or upper(coalesce(current_bidder.initials, '')) is distinct from initials_value
        or current_bidder.email is distinct from coalesce(email_value, current_bidder.email)
        or current_bidder.phone is distinct from coalesce(phone_value, current_bidder.phone)
        or current_bidder.bid_role is distinct from bid_role_value
        or current_bidder.seniority_date is distinct from coalesce(seniority_date_value, current_bidder.seniority_date)
        or current_bidder.active is distinct from active_value;
      update public.bidders set seniority_rank = null where id = target_profile_id;
      imported_target_ids := array_append(imported_target_ids, target_profile_id);
    end if;
    target_ids := array_append(target_ids, target_profile_id);
    changed_rows := array_append(changed_rows, row_changed);
  end loop;

  row_index := 0;
  for roster_item in select value from jsonb_array_elements(requested_rows)
  loop
    row_index := row_index + 1;
    target_profile_id := target_ids[row_index];
    select a.id into strict target_area_id from public.areas a where upper(a.code) = upper(trim(roster_item ->> 'area_code'));
    rank_value := (roster_item ->> 'seniority_rank')::integer;
    first_name_value := trim(roster_item ->> 'first_name');
    last_name_value := trim(roster_item ->> 'last_name');
    initials_value := upper(trim(roster_item ->> 'initials'));
    email_value := lower(nullif(trim(coalesce(roster_item ->> 'email', '')), ''));
    phone_value := nullif(trim(coalesce(roster_item ->> 'phone', '')), '');
    bid_role_value := upper(trim(roster_item ->> 'bid_role'));
    active_value := coalesce((roster_item ->> 'active')::boolean, true);
    seniority_date_value := nullif(trim(coalesce(roster_item ->> 'seniority_date', '')), '')::date;

    if target_profile_id is null then
      insert into public.bidders (area_id, first_name, last_name, initials, email, phone, bid_role, seniority_rank, seniority_date, active)
      values (target_area_id, first_name_value, last_name_value, initials_value, email_value, phone_value, bid_role_value, rank_value, seniority_date_value, active_value);
      added_count := added_count + 1;
    else
      update public.bidders
      set area_id = target_area_id, first_name = first_name_value, last_name = last_name_value,
          initials = initials_value, email = coalesce(email_value, email), phone = coalesce(phone_value, phone),
          bid_role = bid_role_value, seniority_rank = rank_value,
          seniority_date = coalesce(seniority_date_value, seniority_date), active = active_value, updated_at = now()
      where id = target_profile_id;
      if changed_rows[row_index] then updated_count := updated_count + 1; else unchanged_count := unchanged_count + 1; end if;
    end if;
  end loop;

  insert into public.audit_events (actor_id, event_type, entity_table, details)
  values (actor_profile_id, 'seniority_roster.imported', 'bidders', jsonb_build_object(
    'mode', 'safe_upsert', 'rows_processed', jsonb_array_length(requested_rows),
    'bidders_added', added_count, 'bidders_updated', updated_count, 'bidders_unchanged', unchanged_count
  ));

  return jsonb_build_object('rows_processed', jsonb_array_length(requested_rows), 'bidders_added', added_count, 'bidders_updated', updated_count, 'bidders_unchanged', unchanged_count);
end;
$function$;

revoke execute on function private.import_seniority_roster_impl(jsonb) from public, anon;
grant execute on function private.import_seniority_roster_impl(jsonb) to authenticated;

create or replace function public.import_seniority_roster(requested_rows jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_seniority_roster_impl(requested_rows);
$$;

revoke execute on function public.import_seniority_roster(jsonb) from public, anon;
grant execute on function public.import_seniority_roster(jsonb) to authenticated;

comment on function public.import_seniority_roster(jsonb) is
  'Atomically adds or updates roster bidders while preserving existing bidder IDs and related records. Omitted bidders remain unchanged.';
