-- Mark the standalone Area A admin login as an admin-only profile.
-- This profile can access admin tools, but is excluded from BUE bidding mechanics.

do $$
declare
  target_profile_id uuid;
begin
  select b.id
  into target_profile_id
  from public.bidders b
  join public.areas a on a.id = b.area_id
  where b.active
    and a.name = 'Area A'
    and lower(b.email) = 'zla.bidding@gmail.com'
  limit 1;

  if target_profile_id is null then
    raise exception 'No active Area A bidder profile found for zla.bidding@gmail.com.';
  end if;

  update public.bidders
  set role = 'admin',
      bid_role = 'ADM',
      seniority_rank = null,
      leave_slot_allowance = 0,
      updated_at = now()
  where id = target_profile_id;

  delete from public.bid_windows
  where bidder_id = target_profile_id;
end
$$;
