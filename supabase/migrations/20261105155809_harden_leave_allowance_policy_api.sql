-- Keep public RPCs as invokers; privileged writes remain private and admin-gated.
begin;
create or replace function public.read_calendar_year_settings(requested_bid_year integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(settings) || jsonb_build_object(
    'tmu_one_slot_outline', coalesce(display.tmu_one_slot_outline, true),
    'leave_over_accrual_from_round', display.leave_over_accrual_from_round)
  from public.read_bid_year_settings(requested_bid_year) settings
  join public.bid_years y on y.bid_year = settings.bid_year
  left join public.bid_year_settings display on display.bid_year_id = y.id
$$;

create or replace function public.read_leave_allowance_settings(requested_bid_year integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.read_calendar_year_settings(requested_bid_year)
$$;

create or replace function private.set_leave_over_accrual(requested_bid_year integer, starting_round integer)
returns void language plpgsql security definer set search_path = '' as $$
declare target_year uuid;
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can change leave allowance policy.';
  end if;
  if starting_round is not null and starting_round not between 1 and 6 then
    raise exception 'Starting round must be between 1 and 6.';
  end if;
  select id into target_year from public.bid_years where bid_year = requested_bid_year;
  if target_year is null then raise exception 'Bid year does not exist.'; end if;
  insert into public.bid_year_settings(bid_year_id, leave_over_accrual_from_round, updated_by)
  values(target_year, starting_round, public.current_bidder_id())
  on conflict (bid_year_id) do update set
    leave_over_accrual_from_round = excluded.leave_over_accrual_from_round,
    updated_by = excluded.updated_by, updated_at = now();
end
$$;
revoke all on function private.set_leave_over_accrual(integer, integer) from public, anon, authenticated;
grant execute on function private.set_leave_over_accrual(integer, integer) to authenticated;

create or replace function public.set_leave_over_accrual(requested_bid_year integer, starting_round integer)
returns void language sql security invoker set search_path = '' as $$
  select private.set_leave_over_accrual(requested_bid_year, starting_round)
$$;
revoke all on function public.set_leave_over_accrual(integer, integer) from public, anon, authenticated;
grant execute on function public.set_leave_over_accrual(integer, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
