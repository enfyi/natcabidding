-- Shared capacity rules and staff-only manual fatigue overrides.
-- Patch deployed RPCs in place to retain production/pilot-specific rules.

-- Source: database/fatigue_group_balancing.sql
create schema if not exists private;

create or replace function private.rdo_line_fatigue_set(requested_line_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when line.line_type = 'CPC' then upper(trim(line.pattern))
    else coalesce(
      (
        select string_agg(day.weekday::text, '/' order by day.weekday)
        from public.rdo_line_days day
        where day.rdo_line_id = line.id
          and upper(trim(day.shift_code)) = 'RDO'
      ),
      upper(trim(line.pattern))
    )
  end
  from public.rdo_lines line
  where line.id = requested_line_id;
$$;

create or replace function private.fatigue_group_is_available(
  requested_bid_year_id uuid,
  requested_area_id uuid,
  requested_line_id uuid,
  requested_group text,
  excluded_bidder_id uuid default null
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  line_row public.rdo_lines%rowtype;
  pool_type text;
  rdo_set text;
  area_total integer;
  rdo_total integer;
  area_base integer;
  rdo_base integer;
  area_remainder integer;
  rdo_remainder integer;
  area_used integer;
  rdo_used integer;
  area_extra_groups integer;
  rdo_extra_groups integer;
begin
  if requested_group is null or requested_group not in ('A', 'B', 'C') then return false; end if;

  select * into strict line_row
  from public.rdo_lines line
  where line.id = requested_line_id
    and line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id;

  pool_type := case when line_row.line_type = 'CPC' then 'CPC' else 'DEV' end;
  rdo_set := private.rdo_line_fatigue_set(line_row.id);

  select count(*) into area_total
  from public.bidders bidder
  where bidder.area_id = requested_area_id
    and bidder.active
    and case
      when pool_type = 'CPC' then bidder.bid_role in ('CPC', 'TMC')
      else bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV')
    end;

  if area_total = 0 then
    select count(*) into area_total
    from public.rdo_lines line
    where line.bid_year_id = requested_bid_year_id
      and line.area_id = requested_area_id
      and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end;
  end if;

  select count(*) into rdo_total
  from public.rdo_lines line
  where line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id
    and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
    and private.rdo_line_fatigue_set(line.id) = rdo_set;

  area_base := floor(area_total::numeric / 3)::integer;
  rdo_base := floor(rdo_total::numeric / 3)::integer;
  area_remainder := mod(area_total, 3);
  rdo_remainder := mod(rdo_total, 3);

  select count(*) into area_used
  from public.rdo_lines line
  where line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id
    and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
    and line.status = 'taken'
    and line.fatigue_group = requested_group
    and line.assigned_bidder_id is distinct from excluded_bidder_id;

  select count(*) into rdo_used
  from public.rdo_lines line
  where line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id
    and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
    and private.rdo_line_fatigue_set(line.id) = rdo_set
    and line.status = 'taken'
    and line.fatigue_group = requested_group
    and line.assigned_bidder_id is distinct from excluded_bidder_id;

  select count(*) into area_extra_groups
  from (
    select line.fatigue_group
    from public.rdo_lines line
    where line.bid_year_id = requested_bid_year_id
      and line.area_id = requested_area_id
      and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
      and line.status = 'taken'
      and line.fatigue_group in ('A', 'B', 'C')
      and line.assigned_bidder_id is distinct from excluded_bidder_id
    group by line.fatigue_group
    having count(*) > area_base
  ) claimed;

  select count(*) into rdo_extra_groups
  from (
    select line.fatigue_group
    from public.rdo_lines line
    where line.bid_year_id = requested_bid_year_id
      and line.area_id = requested_area_id
      and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
      and private.rdo_line_fatigue_set(line.id) = rdo_set
      and line.status = 'taken'
      and line.fatigue_group in ('A', 'B', 'C')
      and line.assigned_bidder_id is distinct from excluded_bidder_id
    group by line.fatigue_group
    having count(*) > rdo_base
  ) claimed;

  return
    area_used < area_base + case when area_remainder > 0 then 1 else 0 end
    and rdo_used < rdo_base + case when rdo_remainder > 0 then 1 else 0 end
    and not (area_used >= area_base and area_extra_groups >= area_remainder)
    and not (rdo_used >= rdo_base and rdo_extra_groups >= rdo_remainder);
end;
$$;

revoke all on function private.rdo_line_fatigue_set(uuid) from public, anon, authenticated;
revoke all on function private.fatigue_group_is_available(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- Source: database/fatigue_capacity_sync.sql
-- Run after fatigue_group_balancing.sql to upgrade legacy RPC capacity checks.
-- Upgrade only the legacy capacity blocks, preserving deployed window, leave,
-- audit, eligibility, and permission logic. Re-running this script is safe.
do $sync$
declare
  routine record;
  definition text;
  updated text;
  capacity_pattern text := 'select greatest\(1, floor\(count\(\*\)::numeric / 3\)::integer\) into area_max.*?raise exception ''Fatigue group % is full for this area or crew.'', (requested_fatigue_group|requested_group);[[:space:]]*end if;';
  replacement text;
begin
  for routine in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and (
      (n.nspname = 'public' and p.proname in ('submit_rdo_bid', 'review_bidding_submission'))
      or (n.nspname = 'private' and p.proname = 'save_bidder_editor')
    )
  loop
    definition := pg_get_functiondef(routine.oid);
    if position('private.fatigue_group_is_available(' in definition) > 0 then
      continue;
    end if;
    if routine.proname = 'save_bidder_editor' then
      updated := regexp_replace(definition,
        'if line_row.line_type=''CPC'' and target.bid_role <> ''GL'' then[[:space:]]*select greatest\(1,floor\(count\(\*\)::numeric/3\)::integer\) into area_max.*?raise exception ''Fatigue group % is full for this area or crew.'',group_name;[[:space:]]*end if;[[:space:]]*end if;',
        'if line_row.line_type in (''CPC'',''DEV'') and target.bid_role <> ''GL''
          and not private.fatigue_group_is_available(year_id,target.area_id,line_row.id,group_name,target.id) then
          raise exception ''Fatigue group % is full for this area or RDO set.'',group_name;
        end if;', 's');
      if updated = definition then
        raise exception 'Unrecognized fatigue capacity block in %. No changes applied.', routine.proname;
      end if;
      execute updated;
      continue;
    end if;
    if routine.proname = 'submit_rdo_bid' then
      replacement := 'if requested_fatigue_group is not null and not private.fatigue_group_is_available(year_row.id, target.area_id, line_row.id, requested_fatigue_group, target.id) then
      raise exception ''Fatigue group % is full for this area or RDO set.'', requested_fatigue_group;
    end if;';
    else
      replacement := 'if not private.fatigue_group_is_available(submission.bid_year_id, target.area_id, line_row.id, requested_group, target.id) then
          raise exception ''Fatigue group % is full for this area or RDO set.'', requested_group;
        end if;';
    end if;
    updated := regexp_replace(definition, capacity_pattern, replacement, 's');
    if updated = definition then
      raise exception 'Unrecognized fatigue capacity block in %. No changes applied.', routine.proname;
    end if;
    updated := replace(updated, 'if line_row.line_type = ''CPC''', 'if line_row.line_type in (''CPC'', ''DEV'')');
    execute updated;
  end loop;
end;
$sync$;

-- Source: database/manual_fatigue_override.sql
-- Install after fatigue_group_balancing.sql and fatigue_capacity_sync.sql.
-- Staff-only manual entry retains all existing submission validation while
-- deferring just the fatigue capacity check to an explicitly overridden review.

create schema if not exists private;
create table if not exists private.manual_rdo_fatigue_overrides (
  submission_id uuid primary key references public.intake_submissions(id) on delete cascade,
  line_id uuid not null references public.rdo_lines(id),
  fatigue_group text not null check (fatigue_group in ('A','B','C')),
  actor_id uuid not null references public.bidders(id),
  created_at timestamptz not null default now()
);
alter table private.manual_rdo_fatigue_overrides enable row level security;
revoke all on private.manual_rdo_fatigue_overrides from public, anon, authenticated;

create or replace function private.rdo_fatigue_override_authorized(
  requested_submission_id uuid, requested_line_id uuid, requested_group text
)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from private.manual_rdo_fatigue_overrides
    where submission_id = requested_submission_id and line_id = requested_line_id
      and fatigue_group = requested_group
  );
$$;
revoke all on function private.rdo_fatigue_override_authorized(uuid,uuid,text) from public, anon, authenticated;

-- Editing or resubmitting a bid cannot carry an old authorization forward.
create or replace function private.clear_changed_fatigue_override()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from private.manual_rdo_fatigue_overrides
  where submission_id = new.id and (
    new.payload->>'fatigueOverride' is distinct from 'true'
    or new.rdo_line_id is distinct from line_id
    or new.payload->>'fatigueGroup' is distinct from fatigue_group
  );
  return new;
end;
$$;
revoke all on function private.clear_changed_fatigue_override() from public, anon, authenticated;
drop trigger if exists clear_changed_fatigue_override on public.intake_submissions;
create trigger clear_changed_fatigue_override
  after update of payload, rdo_line_id on public.intake_submissions
  for each row execute function private.clear_changed_fatigue_override();

create or replace function public.submit_manual_rdo_fatigue_override(
  requested_bid_year integer,
  requested_line_code text,
  requested_fatigue_group text,
  requested_flex boolean,
  requested_aws boolean,
  requested_mid text,
  requested_round integer default null,
  target_initials text default null,
  target_area_name text default null,
  manual_entry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  result jsonb;
  saved_submission_id uuid;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt()->>'email') and active
  for update;
  if actor.id is null or actor.role not in ('admin', 'intake') then
    raise exception 'Only intake and admin users may override fatigue capacity.';
  end if;
  if not coalesce(manual_entry, false) then
    raise exception 'Fatigue capacity overrides require manual entry.';
  end if;
  if requested_fatigue_group is null or requested_fatigue_group not in ('A','B','C') then
    raise exception 'Choose fatigue group A, B, or C for an override.';
  end if;

  -- The normal RPC still enforces area access, role eligibility, line
  -- availability, bid-year and round rules. Null is its supported intake
  -- assignment path; this wrapper then records the authorized group.
  result := public.submit_rdo_bid(requested_bid_year, requested_line_code,
    null, requested_flex, requested_aws, requested_mid, requested_round,
    target_initials, target_area_name, true);
  saved_submission_id := (result->>'submission_id')::uuid;
  if saved_submission_id is null then raise exception 'Manual RDO submission was not saved.'; end if;

  update public.intake_submissions
  set payload = payload || jsonb_build_object(
    'fatigueGroup', requested_fatigue_group,
    'fatigueOverride', true,
    'fatigueOverrideLine', requested_line_code,
    'fatigueOverrideGroup', requested_fatigue_group,
    'fatigueOverrideActor', actor.id,
    'fatigueOverrideEnteredBy', actor.initials
  ), updated_at = now()
  where id = saved_submission_id and status = 'pending' and submission_type = 'rdo';
  if not found then raise exception 'Pending manual RDO submission was not found.'; end if;

  insert into private.manual_rdo_fatigue_overrides
    (submission_id, line_id, fatigue_group, actor_id)
  select id, rdo_line_id, requested_fatigue_group, actor.id
  from public.intake_submissions where id = saved_submission_id
  on conflict (submission_id) do update set line_id = excluded.line_id,
    fatigue_group = excluded.fatigue_group, actor_id = excluded.actor_id, created_at = now();

  insert into public.audit_events
    (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  select bid_year_id, area_id, actor.id, 'manual_fatigue_override',
    'intake_submissions', id, jsonb_build_object(
      'line', requested_line_code, 'fatigueGroup', requested_fatigue_group,
      'bidder_id', bidder_id)
  from public.intake_submissions where id = saved_submission_id;
  return result;
end;
$$;
revoke all on function public.submit_manual_rdo_fatigue_override(integer,text,text,boolean,boolean,text,integer,text,text,boolean) from public, anon;
grant execute on function public.submit_manual_rdo_fatigue_override(integer,text,text,boolean,boolean,text,integer,text,text,boolean) to authenticated;

-- Upgrade the deployed review without replacing its unrelated validations.
do $upgrade$
declare
  routine regprocedure := to_regprocedure('public.review_bidding_submission(uuid,text,text,jsonb)');
  definition text;
  updated text;
begin
  if routine is null then raise exception 'Install the bidding review RPC first.'; end if;
  definition := pg_get_functiondef(routine);
  if position('private.rdo_fatigue_override_authorized(' in definition) > 0 then return; end if;
  updated := regexp_replace(definition,
    '(private\.fatigue_group_is_available\([[:space:]]*submission\.bid_year_id,[[:space:]]*target\.area_id,[[:space:]]*line_row\.id,[[:space:]]*requested_group,[[:space:]]*target\.id[[:space:]]*\))([[:space:]]+then)',
    '\1 and not private.rdo_fatigue_override_authorized(submission.id, line_row.id, requested_group)\2');
  if updated = definition then
    raise exception 'Unrecognized fatigue review check. Run fatigue_capacity_sync.sql first.';
  end if;
  execute updated;
end;
$upgrade$;
