-- Durable intake-team membership and scheduling for shared admin views.

alter table public.intake_schedules
  add column if not exists bid_year_id uuid references public.bid_years(id) on delete cascade;

update public.intake_schedules schedules
set bid_year_id = byear.id
from public.bid_years byear
where schedules.bid_year_id is null
  and byear.bid_year = 2027;

create index if not exists intake_schedules_bid_year_start_idx
  on public.intake_schedules(bid_year_id, starts_at);

drop policy if exists "users can read intake schedules in own area" on public.intake_schedules;
create policy "users can read intake schedules in own area"
on public.intake_schedules for select
to authenticated
using (
  public.is_current_intake_or_admin()
  or area_id = public.current_bidder_area_id()
  or public.is_bidder_in_current_area(intake_user_id)
);

create or replace function public.set_intake_team_member(
  requested_initials text,
  should_enable boolean
)
returns table (
  bidder_id uuid,
  initials text,
  role text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target public.bidders%rowtype;
begin
  if not public.is_current_admin() then
    raise exception 'Only system admins can change the intake team.';
  end if;

  select * into target
  from public.bidders b
  where upper(b.initials) = upper(trim(requested_initials))
    and b.active
  limit 1;

  if target.id is null then
    raise exception 'The selected BUE was not found.';
  end if;

  if target.role = 'admin' and not should_enable then
    raise exception 'Admin accounts cannot be removed from intake access.';
  end if;

  update public.bidders b
  set role = case
        when should_enable and b.role = 'controller' then 'intake'
        when not should_enable and b.role = 'intake' then 'controller'
        else b.role
      end,
      updated_at = now()
  where b.id = target.id
  returning b.id, b.initials, b.role
  into bidder_id, initials, role;

  insert into public.audit_events (
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    actor_id,
    case when should_enable then 'intake_team_member_added' else 'intake_team_member_removed' end,
    'bidders',
    target.id,
    jsonb_build_object('initials', target.initials, 'enabled', should_enable)
  );

  return next;
end;
$$;

revoke all on function public.set_intake_team_member(text, boolean) from public, anon, authenticated;
grant execute on function public.set_intake_team_member(text, boolean) to authenticated;

create or replace function public.create_intake_schedule(
  requested_bid_year integer,
  requested_initials text,
  requested_starts_at timestamptz,
  requested_ends_at timestamptz,
  requested_scope text default 'All Areas'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target_bid_year_id uuid;
  target_bidder_id uuid;
  new_schedule_id uuid;
begin
  if not public.is_current_intake_or_admin() then
    raise exception 'Intake or admin access is required to create a schedule.';
  end if;

  if requested_starts_at is null or requested_ends_at is null or requested_ends_at <= requested_starts_at then
    raise exception 'Choose a valid start and end time.';
  end if;

  select byear.id into target_bid_year_id
  from public.bid_years byear
  where byear.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % was not found.', requested_bid_year;
  end if;

  select b.id into target_bidder_id
  from public.bidders b
  where upper(b.initials) = upper(trim(requested_initials))
    and b.active
    and b.role in ('intake', 'admin')
  limit 1;

  if target_bidder_id is null then
    raise exception 'Choose an active intake-team member.';
  end if;

  insert into public.intake_schedules (
    bid_year_id,
    area_id,
    intake_user_id,
    starts_at,
    ends_at,
    scope
  ) values (
    target_bid_year_id,
    null,
    target_bidder_id,
    requested_starts_at,
    requested_ends_at,
    coalesce(nullif(trim(requested_scope), ''), 'All Areas')
  )
  returning id into new_schedule_id;

  insert into public.audit_events (
    bid_year_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    target_bid_year_id,
    actor_id,
    'intake_shift_scheduled',
    'intake_schedules',
    new_schedule_id,
    jsonb_build_object(
      'intake_user_id', target_bidder_id,
      'starts_at', requested_starts_at,
      'ends_at', requested_ends_at,
      'scope', coalesce(nullif(trim(requested_scope), ''), 'All Areas')
    )
  );

  return new_schedule_id;
end;
$$;

revoke all on function public.create_intake_schedule(integer, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.create_intake_schedule(integer, text, timestamptz, timestamptz, text) to authenticated;
