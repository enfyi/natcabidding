-- Permanently remove a bidder from the active roster without destroying their
-- historical bids, leave records, or authentication link.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.admin_deactivate_bidder_roster_entry_impl(target_bidder_id uuid)
returns table (
  profile_id uuid,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  target_profile public.bidders%rowtype;
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

  if target_bidder_id is null then
    raise exception 'A bidder ID is required.';
  end if;

  select b.*
  into target_profile
  from public.bidders b
  where b.id = target_bidder_id
  for update;

  if not found then
    raise exception 'The selected bidder no longer exists.';
  end if;
  if target_profile.id = actor_profile_id then
    raise exception 'You cannot delete the account you are currently using.';
  end if;
  if target_profile.bid_role = 'ADM' then
    raise exception 'Admin-only profiles cannot be deleted from the BUE roster.';
  end if;

  update public.bidders b
  set active = false,
      seniority_rank = null,
      updated_at = now()
  where b.id = target_profile.id;

  insert into public.audit_events (area_id, actor_id, event_type, entity_table, entity_id, details)
  values (
    target_profile.area_id,
    actor_profile_id,
    'bidder.deactivated',
    'bidders',
    target_profile.id,
    jsonb_build_object(
      'initials', target_profile.initials,
      'previous_seniority_rank', target_profile.seniority_rank
    )
  );

  return query
  select b.id, b.active
  from public.bidders b
  where b.id = target_profile.id;
end;
$function$;

revoke execute on function private.admin_deactivate_bidder_roster_entry_impl(uuid)
  from public, anon;
grant execute on function private.admin_deactivate_bidder_roster_entry_impl(uuid)
  to authenticated;

create or replace function public.admin_deactivate_bidder_roster_entry(target_bidder_id uuid)
returns table (
  profile_id uuid,
  active boolean
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.admin_deactivate_bidder_roster_entry_impl(target_bidder_id);
$function$;

revoke execute on function public.admin_deactivate_bidder_roster_entry(uuid)
  from public, anon;
grant execute on function public.admin_deactivate_bidder_roster_entry(uuid)
  to authenticated;

comment on function public.admin_deactivate_bidder_roster_entry(uuid) is
  'Admin-only soft deletion by bidder UUID. Removes the bidder from the active roster while preserving linked history.';
