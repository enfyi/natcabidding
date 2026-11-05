-- Apply after tmu_calendar_display.sql and the existing bidding installers.
begin;

-- Existing bid years start with the requested Round 4 policy.
alter table public.bid_year_settings add column if not exists
  leave_over_accrual_from_round integer default 4
  check (leave_over_accrual_from_round between 1 and 6);

create or replace function private.leave_over_accrual_allowed(year_id uuid, round_number integer)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select round_number >= settings.leave_over_accrual_from_round
    from public.bid_year_settings settings where settings.bid_year_id = year_id), false)
$$;
revoke all on function private.leave_over_accrual_allowed(uuid, integer) from public, anon, authenticated;

create or replace function public.read_leave_allowance_settings(requested_bid_year integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.read_calendar_year_settings(requested_bid_year) || jsonb_build_object(
    'leave_over_accrual_from_round', settings.leave_over_accrual_from_round)
  from public.bid_years y left join public.bid_year_settings settings on settings.bid_year_id = y.id
  where y.bid_year = requested_bid_year
$$;
revoke all on function public.read_leave_allowance_settings(integer) from public, anon, authenticated;
grant execute on function public.read_leave_allowance_settings(integer) to anon, authenticated;

create or replace function public.set_leave_over_accrual(requested_bid_year integer, starting_round integer)
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
revoke all on function public.set_leave_over_accrual(integer, integer) from public, anon, authenticated;
grant execute on function public.set_leave_over_accrual(integer, integer) to authenticated;

-- Preserve installed validations,
-- security settings and grants; apply the selected starting round to personal accrual limits.
do $upgrade$
declare
  signature text;
  target_function regprocedure;
  definition text;
  updated_definition text;
begin
  foreach signature in array array[
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)',
    'private.save_bidder_editor(integer,uuid,jsonb,jsonb)',
    'private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)'
  ] loop
    target_function := to_regprocedure(signature);
    if target_function is null then
      raise exception 'Required bidding function is missing: %', signature;
    end if;
    definition := pg_catalog.pg_get_functiondef(target_function);
    updated_definition := replace(definition,
      'if projected_leave_hours > maximum_leave_hours then',
      'if not private.leave_over_accrual_allowed(year_row.id, batch_round) and projected_leave_hours > maximum_leave_hours then');
    -- Edit validators walk all six rounds. Only check later rounds when a bid
    -- actually exists there, so an allowed overage cannot fail a hypothetical round.
    updated_definition := replace(updated_definition,
      'if used_hours >',
      'if not private.leave_over_accrual_allowed(request_row.bid_year_id, check_round) and exists (select 1 from public.leave_requests later_request where later_request.bid_year_id = request_row.bid_year_id and later_request.bidder_id = target.id and later_request.status in (''pending'', ''approved'') and later_request.round_number = check_round) and used_hours >');
    if signature = 'private.save_bidder_editor(integer,uuid,jsonb,jsonb)' then
      updated_definition := replace(updated_definition,
        'check_round', 'round_no');
      updated_definition := replace(updated_definition,
        'request_row.bid_year_id', 'year_id');
    end if;
    if updated_definition = definition and position('private.leave_over_accrual_allowed(' in definition) = 0 then
      raise exception 'Could not locate accrual validation in %', signature;
    end if;
    if updated_definition <> definition then
      execute updated_definition;
    end if;
  end loop;
end
$upgrade$;

notify pgrst, 'reload schema';
commit;
