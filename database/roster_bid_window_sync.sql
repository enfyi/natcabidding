-- Keep published bid windows attached to seniority positions when an admin
-- reorders, transfers, adds, removes, or changes the bidding role of a BUE.
--
-- Install this after the existing admin roster helpers. The wrapper snapshots
-- the current rank-to-window relationship, saves the roster, and then assigns
-- each saved time slot to the BUE who now occupies that rank. Everything runs
-- in one transaction, so a failed window reassignment also rolls back the
-- roster edit.

create or replace function public.admin_save_bidder_roster_rows_with_bid_windows(
  roster_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_bidder_id uuid := public.current_bidder_id();
  reassigned_count integer := 0;
  removed_count integer := 0;
begin
  if not public.is_current_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(roster_rows) <> 'array' or jsonb_array_length(roster_rows) < 1 then
    raise exception 'At least one roster row is required.';
  end if;

  -- A bid window does not store its area or rank. Capture both before the
  -- roster helper changes the bidders that currently own those windows.
  create temporary table roster_bid_window_slots on commit drop as
  select
    bid_window.id as window_id,
    bid_window.bid_year_id,
    bid_window.bidder_id as original_bidder_id,
    bidder.area_id,
    bid_window.round_number,
    bidder.seniority_rank
  from public.bid_windows bid_window
  join public.bid_years bid_year on bid_year.id = bid_window.bid_year_id
  join public.bidders bidder on bidder.id = bid_window.bidder_id
  where bid_year.status in ('draft', 'open')
    and bidder.active
    and bidder.bid_role not in ('ADM', 'NB')
    and bidder.seniority_rank is not null
    and exists (
      select 1
      from jsonb_array_elements(roster_rows) roster_row
      join public.areas affected_area
        on affected_area.id = bidder.area_id
       and affected_area.name in (
         roster_row ->> 'original_area_name',
         roster_row ->> 'profile_area_name'
       )
    );

  -- This existing helper performs the validated, atomic rank update. Dynamic
  -- SQL keeps this migration installable after any compatible helper version.
  execute 'select public.admin_save_bidder_roster_rows($1)' using roster_rows;

  create temporary table roster_bid_window_assignments on commit drop as
  select
    slot.window_id,
    slot.bid_year_id,
    slot.original_bidder_id,
    slot.area_id,
    slot.round_number,
    slot.seniority_rank,
    bidder.id as target_bidder_id,
    gen_random_uuid() as scratch_bidder_id
  from roster_bid_window_slots slot
  left join public.bidders bidder
    on bidder.area_id = slot.area_id
   and bidder.seniority_rank = slot.seniority_rank
   and bidder.active
   and bidder.bid_role not in ('ADM', 'NB');

  -- Move every affected row through a unique temporary bidder first. This
  -- avoids the (bid year, bidder, round) uniqueness collisions produced by a
  -- direct swap while preserving each bid-window ID and its reminder history.
  insert into public.bidders (
    id,
    area_id,
    first_name,
    last_name,
    role,
    bid_role,
    active
  )
  select distinct
    assignment.scratch_bidder_id,
    assignment.area_id,
    'Roster',
    'window sync',
    'controller',
    'ADM',
    false
  from roster_bid_window_assignments assignment
  where assignment.target_bidder_id is distinct from assignment.original_bidder_id;

  update public.bid_windows bid_window
  set bidder_id = assignment.scratch_bidder_id
  from roster_bid_window_assignments assignment
  where bid_window.id = assignment.window_id
    and assignment.target_bidder_id is distinct from assignment.original_bidder_id;

  update public.bid_windows bid_window
  set bidder_id = assignment.target_bidder_id
  from roster_bid_window_assignments assignment
  where bid_window.id = assignment.window_id
    and assignment.target_bidder_id is not null
    and assignment.target_bidder_id is distinct from assignment.original_bidder_id;

  get diagnostics reassigned_count = row_count;

  -- If the active bidding roster became shorter, its trailing time slots no
  -- longer have a valid seniority position and must not remain on a removed or
  -- non-bidding profile.
  delete from public.bid_windows bid_window
  using roster_bid_window_assignments assignment
  where bid_window.id = assignment.window_id
    and assignment.target_bidder_id is null;

  get diagnostics removed_count = row_count;

  delete from public.bidders scratch
  using roster_bid_window_assignments assignment
  where scratch.id = assignment.scratch_bidder_id;

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    details
  )
  select
    assignment.bid_year_id,
    assignment.area_id,
    acting_bidder_id,
    'bid_windows.reassigned_for_seniority',
    'bid_windows',
    jsonb_build_object(
      'windows_reassigned', count(*) filter (where assignment.target_bidder_id is not null),
      'obsolete_windows_removed', count(*) filter (where assignment.target_bidder_id is null)
    )
  from roster_bid_window_assignments assignment
  where assignment.target_bidder_id is distinct from assignment.original_bidder_id
  group by assignment.bid_year_id, assignment.area_id;

  return jsonb_build_object(
    'saved', true,
    'bid_windows_reassigned', reassigned_count,
    'obsolete_bid_windows_removed', removed_count
  );
end;
$function$;

revoke all on function public.admin_save_bidder_roster_rows_with_bid_windows(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_save_bidder_roster_rows_with_bid_windows(jsonb)
  to authenticated;

comment on function public.admin_save_bidder_roster_rows_with_bid_windows(jsonb) is
  'Atomically saves admin roster rows and reassigns active bid-year windows by the resulting area seniority rank.';
