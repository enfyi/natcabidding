create or replace function public.update_intake_schedule(
  requested_bid_year integer,
  requested_schedule_id uuid,
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
  existing_schedule public.intake_schedules%rowtype;
begin
  if auth.uid() is null or not public.is_current_intake_or_admin() then
    raise exception 'Intake or admin access is required to update a schedule.';
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

  select schedules.* into existing_schedule
  from public.intake_schedules schedules
  where schedules.id = requested_schedule_id
    and schedules.bid_year_id = target_bid_year_id
  for update;

  if existing_schedule.id is null then
    raise exception 'The selected intake shift was not found.';
  end if;

  select bidders.id into target_bidder_id
  from public.bidders bidders
  where upper(bidders.initials) = upper(trim(requested_initials))
    and bidders.active
    and bidders.role in ('intake', 'admin')
  limit 1;

  if target_bidder_id is null then
    raise exception 'Choose an active intake-team member.';
  end if;

  update public.intake_schedules schedules
  set intake_user_id = target_bidder_id,
      starts_at = requested_starts_at,
      ends_at = requested_ends_at,
      scope = coalesce(nullif(trim(requested_scope), ''), 'All Areas')
  where schedules.id = existing_schedule.id;

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
    'intake_shift_updated',
    'intake_schedules',
    existing_schedule.id,
    jsonb_build_object(
      'previous_intake_user_id', existing_schedule.intake_user_id,
      'previous_starts_at', existing_schedule.starts_at,
      'previous_ends_at', existing_schedule.ends_at,
      'previous_scope', existing_schedule.scope,
      'intake_user_id', target_bidder_id,
      'starts_at', requested_starts_at,
      'ends_at', requested_ends_at,
      'scope', coalesce(nullif(trim(requested_scope), ''), 'All Areas')
    )
  );

  return existing_schedule.id;
end;
$$;

revoke all on function public.update_intake_schedule(integer, uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.update_intake_schedule(integer, uuid, text, timestamptz, timestamptz, text) to authenticated;

create or replace function public.delete_intake_schedule(
  requested_bid_year integer,
  requested_schedule_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target_bid_year_id uuid;
  existing_schedule public.intake_schedules%rowtype;
begin
  if auth.uid() is null or not public.is_current_intake_or_admin() then
    raise exception 'Intake or admin access is required to delete a schedule.';
  end if;

  select byear.id into target_bid_year_id
  from public.bid_years byear
  where byear.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % was not found.', requested_bid_year;
  end if;

  select schedules.* into existing_schedule
  from public.intake_schedules schedules
  where schedules.id = requested_schedule_id
    and schedules.bid_year_id = target_bid_year_id
  for update;

  if existing_schedule.id is null then
    raise exception 'The selected intake shift was not found.';
  end if;

  delete from public.intake_schedules schedules
  where schedules.id = existing_schedule.id;

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
    'intake_shift_deleted',
    'intake_schedules',
    existing_schedule.id,
    jsonb_build_object(
      'intake_user_id', existing_schedule.intake_user_id,
      'starts_at', existing_schedule.starts_at,
      'ends_at', existing_schedule.ends_at,
      'scope', existing_schedule.scope
    )
  );

  return existing_schedule.id;
end;
$$;

revoke all on function public.delete_intake_schedule(integer, uuid) from public, anon, authenticated;
grant execute on function public.delete_intake_schedule(integer, uuid) to authenticated;
