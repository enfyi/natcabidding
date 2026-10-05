-- Install after fatigue_group_balancing.sql and fatigue_capacity_sync.sql.
-- Staff-only manual entry retains all existing submission validation while
-- deferring just the fatigue capacity check to an explicitly overridden review.
begin;

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
commit;
