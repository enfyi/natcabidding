-- Install after unused_slot_closures.sql. Restores only unoccupied slots closed
-- by those rules. Existing requests, assignments, and manual closures are untouched.
begin;
drop function if exists public.read_slot_closure_rules(integer);
create function public.read_slot_closure_rules(requested_bid_year integer)
returns table(area_name text, slot_group text, after_round integer, close_count integer, applied_at timestamptz, closed_slots bigint)
language sql security invoker set search_path = '' as $$
  select a.name, r.slot_group, r.after_round, r.close_count, r.applied_at,
    (select count(*) from public.leave_slots s
      where s.bid_year_id = r.bid_year_id and s.area_id = r.area_id
        and s.slot_group = r.slot_group and s.status = 'unavailable'
        and s.slot_code = 'CAPACITY-CLOSED-' || s.id::text
        and s.bidder_id is null and s.source_leave_request_id is null
        and nullif(trim(s.slot_initials), '') is null)
  from public.slot_closure_rules r
  join public.areas a on a.id = r.area_id
  join public.bid_years y on y.id = r.bid_year_id
  where y.bid_year = requested_bid_year;
$$;
revoke all on function public.read_slot_closure_rules(integer) from public, anon;
grant execute on function public.read_slot_closure_rules(integer) to authenticated;

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
  if rule.applied_at is null then raise exception 'This closure rule has not been applied.'; end if;
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
  -- Keep applied_at: reopening must not silently rearm a rule that already ran.
  return jsonb_build_object('reopened_slots', reopened);
end;
$$;
revoke all on function private.reopen_slot_closure_rule(integer,text,text,date,date) from public, anon;
grant execute on function private.reopen_slot_closure_rule(integer,text,text,date,date) to authenticated;
create or replace function public.reopen_slot_closure_rule(
  requested_bid_year integer, requested_area_name text, requested_slot_group text,
  requested_start_date date default null, requested_end_date date default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reopen_slot_closure_rule(requested_bid_year, requested_area_name, requested_slot_group,
    requested_start_date, requested_end_date);
$$;
revoke all on function public.reopen_slot_closure_rule(integer,text,text,date,date) from public, anon;
grant execute on function public.reopen_slot_closure_rule(integer,text,text,date,date) to authenticated;
commit;
