-- Install after reopen_unused_slots.sql. Saving edits never changes inventory.
-- Fully reopen a rule before applying its updated settings again.
begin;
create or replace function public.save_slot_closure_rule(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_after_round integer default 3, requested_close_count integer default 1
) returns void language plpgsql security invoker set search_path = '' as $$
declare year_id uuid; target_area uuid;
begin
  if not public.is_current_admin() then raise exception 'Only system admins can save closure rules.'; end if;
  select id into strict year_id from public.bid_years where bid_year = requested_bid_year;
  select id into strict target_area from public.areas
    where lower(name) = lower(trim(requested_area_name)) or lower(code) = lower(trim(requested_area_name));
  insert into public.slot_closure_rules (bid_year_id, area_id, slot_group, after_round, close_count, updated_by)
    values (year_id, target_area, requested_slot_group, requested_after_round, requested_close_count, public.current_bidder_id())
  on conflict (bid_year_id, area_id, slot_group) do update
    set after_round = excluded.after_round, close_count = excluded.close_count, updated_by = excluded.updated_by;
  -- The upsert locks the rule first. A separate statement gets a fresh snapshot
  -- after any concurrent close/reopen finishes; saving cannot rearm live closures.
  update public.slot_closure_rules r set applied_at = null
    where r.bid_year_id = year_id and r.area_id = target_area and r.slot_group = requested_slot_group
      and not exists (select 1 from public.leave_slots s
        where s.bid_year_id = year_id and s.area_id = target_area and s.slot_group = requested_slot_group
          and s.slot_code = 'CAPACITY-CLOSED-' || s.id::text and s.status = 'unavailable'
          and s.bidder_id is null and s.source_leave_request_id is null
          and nullif(trim(s.slot_initials), '') is null);
end;
$$;

create or replace function private.reopen_slot_closure_rule(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date default null, requested_end_date date default null
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
  if (requested_start_date is null) <> (requested_end_date is null)
    or first_date > last_date
    or first_date < make_date(requested_bid_year, 1, 10)
    or last_date > make_date(requested_bid_year + 1, 1, 8) then
    raise exception 'Choose both dates within the bid leave year, or leave both blank to reopen all rule-closed dates.';
  end if;
  select r.* into strict rule from public.slot_closure_rules r
    join public.bid_years y on y.id = r.bid_year_id
    join public.areas a on a.id = r.area_id
    where y.bid_year = requested_bid_year
      and (lower(a.name) = lower(trim(requested_area_name)) or lower(a.code) = lower(trim(requested_area_name)))
      and r.slot_group = requested_slot_group for update of r;
  if rule.applied_at is null then return jsonb_build_object('reopened_slots', 0); end if;
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
        and s.slot_code = 'CAPACITY-CLOSED-' || s.id::text and s.status = 'unavailable'
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
      values(rule.bid_year_id, rule.area_id, public.current_bidder_id(), 'unused_slots_reopened', 'leave_slots',
        jsonb_build_object('slot_date', day.slot_date, 'slot_group', rule.slot_group,
          'reopened_count', changed_count, 'original_applied_at', rule.applied_at));
    reopened := reopened + changed_count;
  end loop;
  -- A partial reopen must not allow another reduction on dates still closed.
  -- Only a fully restored rule can run again (with its latest saved settings).
  if not exists (select 1 from public.leave_slots s
    where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
      and s.slot_group = rule.slot_group and s.slot_code = 'CAPACITY-CLOSED-' || s.id::text
      and s.status = 'unavailable' and s.bidder_id is null and s.source_leave_request_id is null
      and nullif(trim(s.slot_initials), '') is null) then
    update public.slot_closure_rules set applied_at = null
      where bid_year_id = rule.bid_year_id and area_id = rule.area_id and slot_group = rule.slot_group;
  end if;
  return jsonb_build_object('reopened_slots', reopened);
end;
$$;
-- Make rules fully reopened with the previous installer immediately reusable.
-- This only changes rule metadata; requests and inventory are never touched.
update public.slot_closure_rules r set applied_at = null
where r.applied_at is not null and not exists (
  select 1 from public.leave_slots s
  where s.bid_year_id = r.bid_year_id and s.area_id = r.area_id and s.slot_group = r.slot_group
    and s.slot_code = 'CAPACITY-CLOSED-' || s.id::text and s.status = 'unavailable'
    and s.bidder_id is null and s.source_leave_request_id is null
    and nullif(trim(s.slot_initials), '') is null
);
commit;
