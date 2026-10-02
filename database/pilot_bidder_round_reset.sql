-- Install after pilot_mode.sql and pilot_round_controls.sql in the isolated pilot.
create or replace function public.reset_pilot_bidder_round(
  requested_bid_year integer,
  requested_bidder_id uuid,
  requested_round integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_year uuid;
  request_ids uuid[];
begin
  select b.id into actor_id from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.role = 'admin' and b.active;
  if actor_id is null then raise exception 'System administrator access is required.'; end if;
  if requested_round is null or requested_round not between 1 and 6 then
    raise exception 'Choose a bidding round from 1 through 6.';
  end if;

  -- Pilot submissions take a shared settings lock, so a reset cannot race them.
  select s.bid_year_id into target_year from public.bid_year_settings s
  join public.bid_years y on y.id = s.bid_year_id
  where y.bid_year = requested_bid_year and s.pilot_database
  for update of s;
  if target_year is null then
    raise exception 'Reset refused: this is not an isolated pilot database.';
  end if;
  perform 1 from public.bidders b
  join public.bid_year_pilot_members m on m.bidder_id = b.id and m.bid_year_id = target_year
  where b.id = requested_bidder_id and b.active for update of b, m;
  if not found then raise exception 'Choose an active allowed pilot bidder.'; end if;

  select coalesce(array_agg(r.id), '{}'::uuid[]) into request_ids
  from public.leave_requests r
  where r.bid_year_id = target_year and r.bidder_id = requested_bidder_id
    and (requested_round = 1 or r.round_number = requested_round);

  -- Remove added override capacity, then release regular slots before deleting
  -- requests (whose foreign keys would otherwise erase the slot linkage).
  delete from public.leave_slots s
  where s.bid_year_id = target_year
    and (s.source_leave_request_id = any(request_ids)
      or (requested_round = 1 and s.bidder_id = requested_bidder_id))
    and (s.slot_code like 'OVR-%' or s.slot_code like 'OVERRIDE-%');
  update public.leave_slots s
  set bidder_id = null, slot_initials = null, source_leave_request_id = null,
      status = case when s.status = 'unavailable' then 'unavailable' else 'open' end,
      updated_at = now()
  where s.bid_year_id = target_year
    and (s.source_leave_request_id = any(request_ids)
      or (requested_round = 1 and s.bidder_id = requested_bidder_id));

  delete from public.intake_submissions s
  where s.bid_year_id = target_year and s.bidder_id = requested_bidder_id
    and (requested_round = 1 or s.round_number = requested_round);
  delete from public.leave_credit_events e
  where e.bid_year_id = target_year and e.bidder_id = requested_bidder_id
    and (requested_round = 1 or e.round_number = requested_round
      or e.source_leave_request_id = any(request_ids));
  delete from public.leave_requests r where r.id = any(request_ids);

  if requested_round = 1 then
    delete from public.holiday_in_lieu_days h
    where h.bid_year_id = target_year and h.bidder_id = requested_bidder_id;
    update public.rdo_lines l
    set status = 'open', assigned_bidder_id = null, assigned_initials = null, updated_at = now()
    where l.bid_year_id = target_year and l.assigned_bidder_id = requested_bidder_id;
  end if;

  insert into public.audit_events (bid_year_id, actor_id, event_type, entity_table, entity_id, details)
  values (target_year, actor_id, 'pilot_bidder_round_reset', 'bidders', requested_bidder_id,
    jsonb_build_object('round', requested_round, 'all_rounds', requested_round = 1,
      'leave_requests_removed', cardinality(request_ids)));
end;
$$;

revoke all on function public.reset_pilot_bidder_round(integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.reset_pilot_bidder_round(integer, uuid, integer) to authenticated;
