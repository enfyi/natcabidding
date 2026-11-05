-- Independent CPC date closures. Never reads or writes saved area rules.
-- Does not run any closure during installation. Existing full-year API is unchanged.
begin;
create or replace function private.close_specific_date_slots(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date, requested_end_date date,
  requested_after_round integer, requested_close_count integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rule public.slot_closure_rules%rowtype;
  day record;
  pending_count integer;
  close_today integer;
  changed_count integer;
  lock_date date;
  removed integer := 0;
begin
  if auth.uid() is null or not coalesce(public.is_current_admin(), false) then
    raise exception 'Only system admins can close unused slots.';
  end if;
  if requested_slot_group is distinct from 'cpc' then
    raise exception 'Unused slot closures apply only to CPC. DEV slots must remain unchanged.';
  end if;
  select id into strict rule.bid_year_id from public.bid_years where bid_year = requested_bid_year;
  select id into strict rule.area_id from public.areas
    where lower(name) = lower(trim(requested_area_name)) or lower(code) = lower(trim(requested_area_name));
  rule.slot_group := requested_slot_group;
  if requested_after_round is null or requested_after_round not between 1 and 6
    or requested_close_count is null or requested_close_count not between 1 and 99 then
    raise exception 'Choose a round and a whole slot count from 1 to 99.';
  end if;
  rule.after_round := requested_after_round;
  rule.close_count := requested_close_count;
  if requested_start_date is null or requested_end_date is null
    or requested_start_date > requested_end_date
    or requested_start_date < make_date(requested_bid_year, 1, 10)
    or requested_end_date > make_date(requested_bid_year + 1, 1, 8) then
    raise exception 'Choose both closing dates within the bid leave year.';
  end if;
  if not exists (select 1 from public.bid_rounds b
    where b.bid_year_id = rule.bid_year_id and b.round_number = rule.after_round
      and (b.status = 'closed' or b.ends_at <= now())) then
    raise exception 'The selected round must end before unused slots can close.';
  end if;
  -- Use the same area/workforce/date locks as submission preflight before
  -- locking inventory. A pending submission must see either the old or new
  -- capacity atomically, rather than passing preflight during a reduction.
  for lock_date in select distinct s.slot_date from public.leave_slots s
    where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
      and s.slot_group = rule.slot_group
      and s.slot_date between requested_start_date and requested_end_date order by s.slot_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      rule.bid_year_id::text || ':' || rule.area_id::text || ':' || rule.slot_group || ':' || lock_date::text, 0));
  end loop;
  lock table public.leave_slots in share row exclusive mode;
  for day in
    select s.slot_date,
      count(*) filter (where s.slot_group = 'cpc' and not starts_with(s.slot_code, 'CAPACITY-'))::integer as cpc,
      count(*) filter (where s.slot_group = 'cpc' and (not starts_with(s.slot_code, 'CAPACITY-') or s.slot_code = 'CAPACITY-CLOSED-' || s.id::text))::integer as original_cpc,
      count(*) filter (where s.slot_group = 'dev' and not starts_with(s.slot_code, 'CAPACITY-'))::integer as dev,
      count(*) filter (where s.slot_group = rule.slot_group and not starts_with(s.slot_code, 'CAPACITY-') and s.status = 'open'
        and s.bidder_id is null and s.source_leave_request_id is null
        and nullif(trim(s.slot_initials), '') is null)::integer as unused
    from public.leave_slots s where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
      and s.slot_date between requested_start_date and requested_end_date
    group by s.slot_date order by s.slot_date
  loop
    -- A repeated or overlapping range must not reduce an already-closed date again.
    if exists (select 1 from public.leave_slots closed
      where closed.bid_year_id = rule.bid_year_id and closed.area_id = rule.area_id
        and closed.slot_group = rule.slot_group and closed.slot_date = day.slot_date
        and closed.slot_code = 'CAPACITY-DATE-CLOSED-' || closed.id::text) then continue; end if;
    -- Four-slot dates retain all four slots, regardless of holiday metadata.
    if day.original_cpc = 4
      then continue; end if;
    -- Pending requests normally do not own inventory rows yet. Keep enough
    -- open slots for them and for any approved request awaiting slot sync.
    select count(distinct lr.id)::integer into pending_count
      from public.leave_requests lr
      join public.leave_request_dates d on d.leave_request_id = lr.id
      join public.bidders b on b.id = lr.bidder_id
      where lr.bid_year_id = rule.bid_year_id and b.area_id = rule.area_id
        and lr.status in ('pending', 'approved') and not lr.is_ghost_bid
        and b.bid_role not in ('GL', 'ADM', 'NB') and not d.is_rdo
        and d.leave_date = day.slot_date
        and (case when b.bid_role in ('DEV', 'R-DEV', 'D-DEV', 'TMCIT') then 'dev' else 'cpc' end) = rule.slot_group
        and not exists (select 1 from public.leave_slots held
          where held.bid_year_id = rule.bid_year_id and held.area_id = rule.area_id
            and held.slot_date = day.slot_date and held.slot_group = rule.slot_group
            and (held.source_leave_request_id = lr.id or held.bidder_id = b.id
              or nullif(trim(held.slot_initials), '') = b.initials));
    close_today := least(rule.close_count, greatest(day.unused - pending_count, 0));
    if close_today = 0 then continue; end if;
    -- Change only the selected group's unused inventory. Keep occupied rows,
    -- the other workforce, and existing manual unavailability exactly intact.
    update public.leave_slots s set status = 'unavailable', slot_code = 'CAPACITY-DATE-CLOSED-' || s.id::text, updated_at = now()
      where s.id in (select candidate.id from public.leave_slots candidate
        where candidate.bid_year_id = rule.bid_year_id and candidate.area_id = rule.area_id
          and candidate.slot_date = day.slot_date and candidate.slot_group = rule.slot_group
          and not starts_with(candidate.slot_code, 'CAPACITY-')
          and candidate.status = 'open' and candidate.bidder_id is null
          and candidate.source_leave_request_id is null
          and nullif(trim(candidate.slot_initials), '') is null
        order by candidate.slot_code desc limit close_today);
    get diagnostics changed_count = row_count;
    insert into public.leave_slot_capacities(bid_year_id, area_id, slot_date, cpc_capacity, dev_capacity, updated_by)
      values (rule.bid_year_id, rule.area_id, day.slot_date,
        day.cpc - case when rule.slot_group = 'cpc' then changed_count else 0 end,
        day.dev - case when rule.slot_group = 'dev' then changed_count else 0 end,
        public.current_bidder_id())
      on conflict (bid_year_id, area_id, slot_date) do update set
        cpc_capacity = case when rule.slot_group = 'cpc' then excluded.cpc_capacity else leave_slot_capacities.cpc_capacity end,
        dev_capacity = case when rule.slot_group = 'dev' then excluded.dev_capacity else leave_slot_capacities.dev_capacity end,
        updated_by = excluded.updated_by, updated_at = now();
    insert into public.audit_events(bid_year_id, area_id, actor_id, event_type, entity_table, details)
      values (rule.bid_year_id, rule.area_id, public.current_bidder_id(), 'specific_date_slots_closed', 'leave_slots',
        jsonb_build_object('slot_date', day.slot_date, 'slot_group', rule.slot_group,
          'closed_count', changed_count, 'after_round', rule.after_round));
    removed := removed + changed_count;
  end loop;
  return jsonb_build_object('closed_slots', removed);
end;
$$;
revoke all on function private.close_specific_date_slots(integer,text,text,date,date,integer,integer) from public, anon;
grant execute on function private.close_specific_date_slots(integer,text,text,date,date,integer,integer) to authenticated;
create or replace function public.close_specific_date_slots(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date, requested_end_date date,
  requested_after_round integer, requested_close_count integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.close_specific_date_slots(requested_bid_year, requested_area_name, requested_slot_group,
    requested_start_date, requested_end_date, requested_after_round, requested_close_count);
$$;
revoke all on function public.close_specific_date_slots(integer,text,text,date,date,integer,integer) from public, anon;
grant execute on function public.close_specific_date_slots(integer,text,text,date,date,integer,integer) to authenticated;
create or replace function public.apply_slot_closure_range(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date, requested_end_date date
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Refresh the page and use the separate specific-date closure controls.';
end;
$$;
revoke all on function public.apply_slot_closure_range(integer,text,text,date,date) from public, anon;
grant execute on function public.apply_slot_closure_range(integer,text,text,date,date) to authenticated;
-- Disable the previous internal range API as well, so stale callers cannot mutate area rules.
create or replace function private.apply_slot_closure_range(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date, requested_end_date date
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Refresh the page and use the separate specific-date closure controls.';
end;
$$;
revoke all on function private.apply_slot_closure_range(integer,text,text,date,date) from public, anon;
grant execute on function private.apply_slot_closure_range(integer,text,text,date,date) to authenticated;
create or replace function private.reopen_specific_date_slots(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date, requested_end_date date
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rule public.slot_closure_rules%rowtype;
  first_date date := coalesce(requested_start_date, make_date(requested_bid_year, 1, 10));
  last_date date := coalesce(requested_end_date, make_date(requested_bid_year + 1, 1, 8));
  lock_date date;
  day record;
  changed_count integer;
  reopened integer := 0;
begin
  if auth.uid() is null or not coalesce(public.is_current_admin(), false) then
    raise exception 'Only system admins can reopen closed slots.';
  end if;
  if requested_start_date is null or requested_end_date is null
    or first_date > last_date
    or first_date < make_date(requested_bid_year, 1, 10)
    or last_date > make_date(requested_bid_year + 1, 1, 8) then
    raise exception 'Choose both dates within the bid leave year, for specific-date reopening.';
  end if;
  if requested_slot_group is distinct from 'cpc' then raise exception 'Specific-date closures apply only to CPC.'; end if;
  select id into strict rule.bid_year_id from public.bid_years where bid_year = requested_bid_year;
  select id into strict rule.area_id from public.areas
    where lower(name) = lower(trim(requested_area_name)) or lower(code) = lower(trim(requested_area_name));
  rule.slot_group := requested_slot_group;
  -- Share the submission/closure locks. No bid can claim a slot while its
  -- availability and capacity are being restored in this transaction.
  for lock_date in select distinct s.slot_date from public.leave_slots s
    where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
      and s.slot_group = rule.slot_group and s.slot_date between first_date and last_date
    order by s.slot_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      rule.bid_year_id::text || ':' || rule.area_id::text || ':' || rule.slot_group || ':' || lock_date::text, 0));
  end loop;
  lock table public.leave_slots in share row exclusive mode;
  for day in select s.slot_date,
    count(*) filter(where s.slot_group = 'cpc' and not starts_with(s.slot_code, 'CAPACITY-'))::integer as cpc,
    count(*) filter(where s.slot_group = 'dev' and not starts_with(s.slot_code, 'CAPACITY-'))::integer as dev
    from public.leave_slots s where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
      and s.slot_date between first_date and last_date
    group by s.slot_date order by s.slot_date
  loop
    update public.leave_slots s
      set status = 'open', slot_code = 'REOPENED-' || s.id::text, updated_at = now()
      where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
        and s.slot_date = day.slot_date and s.slot_group = rule.slot_group
        and s.slot_code = 'CAPACITY-DATE-CLOSED-' || s.id::text and s.status = 'unavailable'
        and s.bidder_id is null and s.source_leave_request_id is null
        and nullif(trim(s.slot_initials), '') is null;
    get diagnostics changed_count = row_count;
    if changed_count = 0 then continue; end if;
    insert into public.leave_slot_capacities(bid_year_id, area_id, slot_date, cpc_capacity, dev_capacity, updated_by)
      values(rule.bid_year_id, rule.area_id, day.slot_date,
        day.cpc + case when rule.slot_group = 'cpc' then changed_count else 0 end,
        day.dev + case when rule.slot_group = 'dev' then changed_count else 0 end,
        public.current_bidder_id())
      on conflict(bid_year_id, area_id, slot_date) do update set
        cpc_capacity = leave_slot_capacities.cpc_capacity + case when rule.slot_group = 'cpc' then changed_count else 0 end,
        dev_capacity = leave_slot_capacities.dev_capacity + case when rule.slot_group = 'dev' then changed_count else 0 end,
        updated_by = excluded.updated_by, updated_at = now();
    insert into public.audit_events(bid_year_id, area_id, actor_id, event_type, entity_table, details)
      values(rule.bid_year_id, rule.area_id, public.current_bidder_id(), 'specific_date_slots_reopened', 'leave_slots',
        jsonb_build_object('slot_date', day.slot_date, 'slot_group', rule.slot_group,
          'reopened_count', changed_count));
    reopened := reopened + changed_count;
  end loop;
  return jsonb_build_object('reopened_slots', reopened);
end;
$$;
revoke all on function private.reopen_specific_date_slots(integer,text,text,date,date) from public, anon;
grant execute on function private.reopen_specific_date_slots(integer,text,text,date,date) to authenticated;
create or replace function public.reopen_specific_date_slots(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date, requested_end_date date
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reopen_specific_date_slots(requested_bid_year, requested_area_name, requested_slot_group,
    requested_start_date, requested_end_date);
$$;
revoke all on function public.reopen_specific_date_slots(integer,text,text,date,date) from public, anon;
grant execute on function public.reopen_specific_date_slots(integer,text,text,date,date) to authenticated;
-- Include independently closed slots in calendar display without changing rule counts.
do $reader$
declare definition text;
begin
  definition := pg_get_functiondef('public.read_public_leave_slots(integer)'::regprocedure);
  definition := replace(definition, $old$slot.slot_code = 'CAPACITY-CLOSED-' || slot.id::text$old$,
    $new$slot.slot_code in ('CAPACITY-CLOSED-' || slot.id::text, 'CAPACITY-DATE-CLOSED-' || slot.id::text)$new$);
  execute definition;
end;
$reader$;
commit;
