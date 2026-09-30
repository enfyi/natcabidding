-- Keep draft/open bid-window assignments attached to seniority positions when
-- an administrator changes the roster order.

create or replace function private.admin_save_bidder_roster_rows_with_windows_impl(roster_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  save_result jsonb;
  reassigned_count integer := 0;
  removed_count integer := 0;
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

  create temporary table admin_roster_bid_window_slots on commit drop as
  select
    bid_window.id as window_id,
    bid_window.bid_year_id,
    bid_window.bidder_id as original_bidder_id,
    bidder.area_id,
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
      from jsonb_array_elements(roster_rows) roster_item
      join public.areas affected_area
        on affected_area.id = bidder.area_id
       and lower(affected_area.name) in (
         lower(roster_item ->> 'original_area_name'),
         lower(roster_item ->> 'profile_area_name')
       )
    );

  save_result := private.admin_save_bidder_roster_rows_impl(roster_rows);

  create temporary table admin_roster_bid_window_assignments on commit drop as
  select
    slot.window_id,
    slot.bid_year_id,
    slot.original_bidder_id,
    slot.area_id,
    bidder.id as target_bidder_id,
    gen_random_uuid() as scratch_bidder_id
  from admin_roster_bid_window_slots slot
  left join public.bidders bidder
    on bidder.area_id = slot.area_id
   and bidder.seniority_rank = slot.seniority_rank
   and bidder.active
   and bidder.bid_role not in ('ADM', 'NB');

  insert into public.bidders (id, area_id, first_name, last_name, role, bid_role, active)
  select
    assignment.scratch_bidder_id,
    assignment.area_id,
    'Roster',
    'window sync',
    'controller',
    'ADM',
    false
  from admin_roster_bid_window_assignments assignment
  where assignment.target_bidder_id is distinct from assignment.original_bidder_id;

  update public.bid_windows bid_window
  set bidder_id = assignment.scratch_bidder_id
  from admin_roster_bid_window_assignments assignment
  where bid_window.id = assignment.window_id
    and assignment.target_bidder_id is distinct from assignment.original_bidder_id;

  update public.bid_windows bid_window
  set bidder_id = assignment.target_bidder_id
  from admin_roster_bid_window_assignments assignment
  where bid_window.id = assignment.window_id
    and assignment.target_bidder_id is not null
    and assignment.target_bidder_id is distinct from assignment.original_bidder_id;

  get diagnostics reassigned_count = row_count;

  delete from public.bid_windows bid_window
  using admin_roster_bid_window_assignments assignment
  where bid_window.id = assignment.window_id
    and assignment.target_bidder_id is null;

  get diagnostics removed_count = row_count;

  delete from public.bidders scratch
  using admin_roster_bid_window_assignments assignment
  where scratch.id = assignment.scratch_bidder_id;

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, details)
  select
    assignment.bid_year_id,
    assignment.area_id,
    actor_profile_id,
    'bid_windows.reassigned_for_seniority',
    'bid_windows',
    jsonb_build_object(
      'windows_reassigned', count(*) filter (where assignment.target_bidder_id is not null),
      'obsolete_windows_removed', count(*) filter (where assignment.target_bidder_id is null)
    )
  from admin_roster_bid_window_assignments assignment
  where assignment.target_bidder_id is distinct from assignment.original_bidder_id
  group by assignment.bid_year_id, assignment.area_id;

  return save_result || jsonb_build_object(
    'bid_windows_reassigned', reassigned_count,
    'obsolete_bid_windows_removed', removed_count
  );
end;
$function$;

revoke execute on function private.admin_save_bidder_roster_rows_with_windows_impl(jsonb) from public, anon;
grant execute on function private.admin_save_bidder_roster_rows_with_windows_impl(jsonb) to authenticated;

create or replace function public.admin_save_bidder_roster_rows(roster_rows jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_save_bidder_roster_rows_with_windows_impl(roster_rows);
$function$;

revoke execute on function public.admin_save_bidder_roster_rows(jsonb) from public, anon;
grant execute on function public.admin_save_bidder_roster_rows(jsonb) to authenticated;
