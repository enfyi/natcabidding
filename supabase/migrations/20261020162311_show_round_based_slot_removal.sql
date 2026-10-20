-- Install after leave_slot_capacity_admin.sql and public_leave_slots_read.sql. Configuration is opt-in for each
-- area/workforce. Applying is an explicit admin action after the round ends.
begin;
create table if not exists public.slot_closure_rules (
  bid_year_id uuid not null references public.bid_years(id) on delete cascade,
  area_id uuid not null references public.areas(id) on delete cascade,
  slot_group text not null check (slot_group in ('cpc', 'dev')),
  after_round integer not null default 3 check (after_round between 1 and 6),
  close_count integer not null default 1 check (close_count between 1 and 99),
  applied_at timestamptz,
  updated_by uuid references public.bidders(id),
  primary key (bid_year_id, area_id, slot_group)
);
alter table public.slot_closure_rules enable row level security;
revoke all on public.slot_closure_rules from anon, authenticated;
grant select, insert, update on public.slot_closure_rules to authenticated;
drop policy if exists "admins manage slot closure rules" on public.slot_closure_rules;
create policy "admins manage slot closure rules" on public.slot_closure_rules
  for all to authenticated using (public.is_current_admin())
  with check (public.is_current_admin());

create or replace function public.read_slot_closure_rules(requested_bid_year integer)
returns table(area_name text, slot_group text, after_round integer, close_count integer, applied_at timestamptz)
language sql security invoker set search_path = '' as $$
  select a.name, r.slot_group, r.after_round, r.close_count, r.applied_at
  from public.slot_closure_rules r
  join public.areas a on a.id = r.area_id
  join public.bid_years y on y.id = r.bid_year_id
  where y.bid_year = requested_bid_year;
$$;

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
    set after_round = excluded.after_round, close_count = excluded.close_count, updated_by = excluded.updated_by
    where slot_closure_rules.applied_at is null;
  if not found then raise exception 'This rule was already applied and cannot be changed.'; end if;
end;
$$;

create or replace function private.apply_slot_closure_rule(
  requested_bid_year integer, requested_area_name text, requested_slot_group text
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
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can close unused slots.';
  end if;
  select r.* into strict rule from public.slot_closure_rules r
    join public.bid_years y on y.id = r.bid_year_id
    join public.areas a on a.id = r.area_id
    where y.bid_year = requested_bid_year
      and (lower(a.name) = lower(trim(requested_area_name)) or lower(a.code) = lower(trim(requested_area_name)))
      and r.slot_group = requested_slot_group for update of r;
  if rule.applied_at is not null then raise exception 'This closure rule has already been applied.'; end if;
  if not exists (select 1 from public.bid_rounds b
    where b.bid_year_id = rule.bid_year_id and b.round_number = rule.after_round
      and (b.status = 'closed' or b.ends_at <= now())) then
    raise exception 'The selected round must end before unused slots can close.';
  end if;
  -- Use the same area/workforce/date locks as submission preflight before
  -- locking inventory. A pending submission must see either the old or new
  -- capacity atomically, rather than passing preflight during a reduction.
  for lock_date in select distinct s.slot_date from public.leave_slots s
    where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id order by s.slot_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      rule.bid_year_id::text || ':' || rule.area_id::text || ':' || rule.slot_group || ':' || lock_date::text, 0));
  end loop;
  lock table public.leave_slots in share row exclusive mode;
  for day in
    select s.slot_date,
      count(*) filter (where s.slot_group = 'cpc' and not starts_with(s.slot_code, 'CAPACITY-'))::integer as cpc,
      count(*) filter (where s.slot_group = 'dev' and not starts_with(s.slot_code, 'CAPACITY-'))::integer as dev,
      count(*) filter (where s.slot_group = rule.slot_group and not starts_with(s.slot_code, 'CAPACITY-') and s.status = 'open'
        and s.bidder_id is null and s.source_leave_request_id is null
        and nullif(trim(s.slot_initials), '') is null)::integer as unused
    from public.leave_slots s where s.bid_year_id = rule.bid_year_id and s.area_id = rule.area_id
    group by s.slot_date order by s.slot_date
  loop
    -- Holiday weeks use Sunday-Saturday, matching the bidding calendar.
    if (case when rule.slot_group = 'cpc' then day.cpc else day.dev end) = 4
      and exists (select 1 from public.holidays h where h.bid_year_id = rule.bid_year_id
        and h.holiday_date between day.slot_date - extract(dow from day.slot_date)::integer
        and day.slot_date - extract(dow from day.slot_date)::integer + 6) then continue; end if;
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
    update public.leave_slots s set status = 'unavailable', slot_code = 'CAPACITY-CLOSED-' || s.id::text, updated_at = now()
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
      values (rule.bid_year_id, rule.area_id, public.current_bidder_id(), 'unused_slots_closed', 'leave_slots',
        jsonb_build_object('slot_date', day.slot_date, 'slot_group', rule.slot_group,
          'closed_count', changed_count, 'after_round', rule.after_round));
    removed := removed + changed_count;
  end loop;
  update public.slot_closure_rules set applied_at = now() where bid_year_id = rule.bid_year_id
    and area_id = rule.area_id and slot_group = rule.slot_group;
  return jsonb_build_object('closed_slots', removed);
end;
$$;
revoke all on function private.apply_slot_closure_rule(integer, text, text) from public, anon;
grant execute on function private.apply_slot_closure_rule(integer, text, text) to authenticated;
create or replace function public.apply_slot_closure_rule(
  requested_bid_year integer, requested_area_name text, requested_slot_group text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.apply_slot_closure_rule(requested_bid_year, requested_area_name, requested_slot_group);
$$;
revoke all on function public.read_slot_closure_rules(integer) from public, anon;
revoke all on function public.save_slot_closure_rule(integer, text, text, integer, integer) from public, anon;
revoke all on function public.apply_slot_closure_rule(integer, text, text) from public, anon;
grant execute on function public.read_slot_closure_rules(integer) to authenticated;
grant execute on function public.save_slot_closure_rule(integer, text, text, integer, integer) to authenticated;
grant execute on function public.apply_slot_closure_rule(integer, text, text) to authenticated;
commit;
