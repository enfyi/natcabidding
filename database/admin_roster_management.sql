-- Admin-only, atomic roster editing for the browser roster manager. Existing
-- bidders are addressed by immutable UUID so area, rank, initials, and contact
-- changes cannot make the update lose track of the selected profile.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.admin_save_bidder_roster_rows_impl(roster_rows jsonb)
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
  first_name_value text;
  last_name_value text;
  initials_value text;
  email_value text;
  phone_value text;
  area_name_value text;
  bid_role_value text;
  rank_value integer;
  allowance_value integer;
  active_value boolean;
  original_initials_value text;
  row_number integer := 0;
  row_index integer := 0;
  target_ids uuid[] := array[]::uuid[];
  saved_ids uuid[] := array[]::uuid[];
  initials_values text[] := array[]::text[];
  email_values text[] := array[]::text[];
  rank_keys text[] := array[]::text[];
  requested_key text;
begin
  select b.id
  into actor_profile_id
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.role = 'admin'
    and b.active
  limit 1;

  if actor_profile_id is null then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(roster_rows) <> 'array' then
    raise exception 'Roster rows must be a JSON array.';
  end if;
  if jsonb_array_length(roster_rows) < 1 or jsonb_array_length(roster_rows) > 500 then
    raise exception 'Save between 1 and 500 roster rows at a time.';
  end if;

  for roster_item in select value from jsonb_array_elements(roster_rows)
  loop
    row_number := row_number + 1;
    first_name_value := trim(coalesce(roster_item ->> 'profile_first_name', ''));
    last_name_value := trim(coalesce(roster_item ->> 'profile_last_name', ''));
    initials_value := upper(trim(coalesce(roster_item ->> 'profile_initials', '')));
    email_value := lower(nullif(trim(coalesce(roster_item ->> 'profile_email', '')), ''));
    phone_value := nullif(trim(coalesce(roster_item ->> 'profile_phone', '')), '');
    area_name_value := trim(coalesce(roster_item ->> 'profile_area_name', ''));
    bid_role_value := upper(trim(coalesce(roster_item ->> 'profile_bid_role', '')));
    active_value := coalesce((roster_item ->> 'profile_active')::boolean, true);
    original_initials_value := upper(trim(coalesce(roster_item ->> 'original_initials', '')));

    if first_name_value = '' or last_name_value = '' or initials_value = '' then
      raise exception 'Row % requires first name, last name, and initials.', row_number;
    end if;
    if length(initials_value) > 12 then raise exception 'Row % initials must be 12 characters or fewer.', row_number; end if;
    if email_value is not null and email_value !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      raise exception 'Row % has an invalid email address.', row_number;
    end if;

    select a.id into target_area_id
    from public.areas a
    where lower(a.name) = lower(area_name_value);
    if target_area_id is null then raise exception 'Row % area % does not exist.', row_number, area_name_value; end if;

    if (area_name_value = 'TMU' and bid_role_value not in ('TMC', 'DEV', 'GL', 'NB'))
      or (area_name_value <> 'TMU' and bid_role_value not in ('CPC', 'GL', 'R-DEV', 'D-DEV', 'NB')) then
      raise exception 'Row % bid role % is not valid for %.', row_number, bid_role_value, area_name_value;
    end if;

    rank_value := null;
    if active_value and bid_role_value <> 'NB' then
      if coalesce(roster_item ->> 'profile_seniority_rank', '') !~ '^\d{1,4}$' then
        raise exception 'Row % requires a valid seniority rank.', row_number;
      end if;
      rank_value := (roster_item ->> 'profile_seniority_rank')::integer;
      if rank_value < 1 or rank_value > 1000 then raise exception 'Row % seniority rank must be between 1 and 1000.', row_number; end if;
    end if;

    if coalesce(roster_item ->> 'profile_leave_slot_allowance', '') !~ '^\d{1,5}$' then
      raise exception 'Row % requires a non-negative leave allowance.', row_number;
    end if;
    allowance_value := (roster_item ->> 'profile_leave_slot_allowance')::integer;

    requested_profile_id := null;
    if nullif(trim(coalesce(roster_item ->> 'profile_id', '')), '') is not null then
      begin
        requested_profile_id := (roster_item ->> 'profile_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Row % has an invalid profile ID.', row_number;
      end;
    end if;

    target_profile_id := requested_profile_id;
    if target_profile_id is not null and not exists (
      select 1 from public.bidders b where b.id = target_profile_id and b.bid_role <> 'ADM'
    ) then
      raise exception 'Row % profile ID does not identify a rostered bidder.', row_number;
    end if;
    if target_profile_id is null and original_initials_value <> '' then
      select b.id into target_profile_id
      from public.bidders b
      where b.bid_role <> 'ADM'
        and b.active
        and upper(trim(coalesce(b.initials, ''))) = original_initials_value
      limit 1;
    end if;
    if target_profile_id = actor_profile_id then
      if not active_value then
        raise exception 'You cannot deactivate the admin account you are currently using.';
      end if;
      if email_value is distinct from lower(auth.jwt() ->> 'email') then
        raise exception 'You cannot change the roster email for the admin account you are currently using.';
      end if;
    end if;
    if target_profile_id is not null and target_profile_id = any(array_remove(target_ids, null)) then
      raise exception 'Row % identifies a bidder already included in this save.', row_number;
    end if;
    if active_value then
      if initials_value = any(initials_values) then raise exception 'Initials % occur more than once in this save.', initials_value; end if;
      initials_values := array_append(initials_values, initials_value);
    end if;
    if email_value is not null then
      if email_value = any(email_values) then raise exception 'Email % occurs more than once in this save.', email_value; end if;
      email_values := array_append(email_values, email_value);
    end if;
    if active_value and rank_value is not null then
      requested_key := target_area_id::text || ':' || rank_value::text;
      if requested_key = any(rank_keys) then raise exception 'Area % seniority rank % occurs more than once in this save.', area_name_value, rank_value; end if;
      rank_keys := array_append(rank_keys, requested_key);
    end if;
    target_ids := array_append(target_ids, target_profile_id);
  end loop;

  if exists (
    select 1 from public.bidders b
    where not (b.id = any(array_remove(target_ids, null)))
      and b.bid_role <> 'ADM'
      and b.active
      and upper(trim(coalesce(b.initials, ''))) = any(initials_values)
  ) then
    raise exception 'One or more initials are already assigned to another bidder.';
  end if;
  if exists (
    select 1 from public.bidders b
    where not (b.id = any(array_remove(target_ids, null)))
      and b.active
      and lower(b.email) = any(email_values)
  ) then
    raise exception 'One or more emails are already assigned to another active bidder.';
  end if;

  update public.bidders b
  set seniority_rank = null
  where b.id = any(array_remove(target_ids, null));

  for roster_item in select value from jsonb_array_elements(roster_rows)
  loop
    row_index := row_index + 1;
    target_profile_id := target_ids[row_index];
    first_name_value := trim(roster_item ->> 'profile_first_name');
    last_name_value := trim(roster_item ->> 'profile_last_name');
    initials_value := upper(trim(roster_item ->> 'profile_initials'));
    email_value := lower(nullif(trim(coalesce(roster_item ->> 'profile_email', '')), ''));
    phone_value := nullif(trim(coalesce(roster_item ->> 'profile_phone', '')), '');
    area_name_value := trim(roster_item ->> 'profile_area_name');
    bid_role_value := upper(trim(roster_item ->> 'profile_bid_role'));
    active_value := coalesce((roster_item ->> 'profile_active')::boolean, true);
    allowance_value := (roster_item ->> 'profile_leave_slot_allowance')::integer;
    rank_value := case when active_value and bid_role_value <> 'NB' then (roster_item ->> 'profile_seniority_rank')::integer else null end;
    select a.id into strict target_area_id from public.areas a where lower(a.name) = lower(area_name_value);

    if target_profile_id is null then
      insert into public.bidders (area_id, first_name, last_name, initials, email, phone, bid_role, seniority_rank, leave_slot_allowance, active)
      values (target_area_id, first_name_value, last_name_value, initials_value, email_value, phone_value, bid_role_value, rank_value, allowance_value, active_value)
      returning id into target_profile_id;
    else
      update public.bidders b
      set area_id = target_area_id,
          first_name = first_name_value,
          last_name = last_name_value,
          initials = initials_value,
          email = email_value,
          phone = phone_value,
          bid_role = bid_role_value,
          seniority_rank = rank_value,
          leave_slot_allowance = allowance_value,
          active = active_value,
          updated_at = now()
      where b.id = target_profile_id;
    end if;
    saved_ids := array_append(saved_ids, target_profile_id);
  end loop;

  insert into public.audit_events (actor_id, event_type, entity_table, details)
  values (
    actor_profile_id,
    'bidder.roster_saved',
    'bidders',
    jsonb_build_object('rows_processed', row_index, 'profile_ids', to_jsonb(saved_ids))
  );

  return jsonb_build_object('saved', true, 'rows_processed', row_index, 'profile_ids', to_jsonb(saved_ids));
end;
$function$;

revoke execute on function private.admin_save_bidder_roster_rows_impl(jsonb) from public, anon;
grant execute on function private.admin_save_bidder_roster_rows_impl(jsonb) to authenticated;

create or replace function public.admin_save_bidder_roster_rows(roster_rows jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_save_bidder_roster_rows_impl(roster_rows);
$function$;

revoke execute on function public.admin_save_bidder_roster_rows(jsonb) from public, anon;
grant execute on function public.admin_save_bidder_roster_rows(jsonb) to authenticated;

create or replace function public.admin_save_bidder_roster_entry(
  profile_id uuid,
  original_area_name text,
  original_initials text,
  original_seniority_rank integer,
  profile_first_name text,
  profile_last_name text,
  profile_initials text,
  profile_email text,
  profile_phone text,
  profile_area_name text,
  profile_bid_role text,
  profile_seniority_rank integer,
  profile_leave_slot_allowance integer,
  profile_active boolean
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_save_bidder_roster_rows_impl(jsonb_build_array(jsonb_build_object(
    'profile_id', profile_id,
    'original_area_name', original_area_name,
    'original_initials', original_initials,
    'original_seniority_rank', original_seniority_rank,
    'profile_first_name', profile_first_name,
    'profile_last_name', profile_last_name,
    'profile_initials', profile_initials,
    'profile_email', profile_email,
    'profile_phone', profile_phone,
    'profile_area_name', profile_area_name,
    'profile_bid_role', profile_bid_role,
    'profile_seniority_rank', profile_seniority_rank,
    'profile_leave_slot_allowance', profile_leave_slot_allowance,
    'profile_active', profile_active
  )));
$function$;

revoke execute on function public.admin_save_bidder_roster_entry(uuid, text, text, integer, text, text, text, text, text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.admin_save_bidder_roster_entry(uuid, text, text, integer, text, text, text, text, text, text, text, integer, integer, boolean) to authenticated;
