-- Install after round_four_over_accrual.sql. Approval policy is independent
-- of submission policy and defaults to allowing over-accrual in Rounds 4–6.
begin;
alter table public.bid_year_settings add column if not exists
  leave_approval_over_accrual boolean not null default true;

create or replace function public.read_calendar_year_settings(requested_bid_year integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(settings) || jsonb_build_object(
    'tmu_one_slot_outline', coalesce(display.tmu_one_slot_outline, true),
    'leave_over_accrual_from_round', display.leave_over_accrual_from_round,
    'leave_approval_over_accrual', coalesce(display.leave_approval_over_accrual, true))
  from public.read_bid_year_settings(requested_bid_year) settings
  join public.bid_years y on y.bid_year = settings.bid_year
  left join public.bid_year_settings display on display.bid_year_id = y.id
$$;

create or replace function private.set_leave_approval_over_accrual(requested_bid_year integer, enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare target_year uuid;
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can change leave approval policy.';
  end if;
  if enabled is null then raise exception 'An on or off value is required.'; end if;
  select id into target_year from public.bid_years where bid_year = requested_bid_year;
  if target_year is null then raise exception 'Bid year does not exist.'; end if;
  insert into public.bid_year_settings(bid_year_id, leave_approval_over_accrual, updated_by)
  values(target_year, enabled, public.current_bidder_id())
  on conflict (bid_year_id) do update set
    leave_approval_over_accrual = excluded.leave_approval_over_accrual,
    updated_by = excluded.updated_by, updated_at = now();
end
$$;
revoke all on function private.set_leave_approval_over_accrual(integer,boolean) from public,anon,authenticated;
grant execute on function private.set_leave_approval_over_accrual(integer,boolean) to authenticated;
create or replace function public.set_leave_approval_over_accrual(requested_bid_year integer, enabled boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.set_leave_approval_over_accrual(requested_bid_year, enabled)
$$;
revoke all on function public.set_leave_approval_over_accrual(integer,boolean) from public,anon,authenticated;
grant execute on function public.set_leave_approval_over_accrual(integer,boolean) to authenticated;

-- Explicitly authorize permanent and scheduled intake for every area.
create or replace function private.can_review_intake_year(requested_year_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.bidders actor
    where actor.auth_user_id = auth.uid()
      and lower(actor.email) = lower(auth.jwt() ->> 'email') and actor.active
      and (actor.role in ('admin','intake') or exists (
        select 1 from public.intake_schedules schedule
        where schedule.intake_user_id = actor.id
          and (schedule.bid_year_id = requested_year_id or schedule.bid_year_id is null)
          and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
      ))
  )
$$;
revoke all on function private.can_review_intake_year(uuid) from public,anon,authenticated;

create or replace function private.assert_leave_approval_allowance(year_id uuid, bidder_to_review uuid, round_no integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare day_hours integer; base_hours integer; used_hours integer; credit_days integer := 0;
begin
  if round_no between 4 and 6 and coalesce((select settings.leave_approval_over_accrual
    from public.bid_year_settings settings where settings.bid_year_id=year_id),true) then
    return;
  end if;
  select allowance.hours_per_day, bidder.leave_slot_allowance into day_hours, base_hours
  from private.round_four_allowances allowance join public.bidders bidder on bidder.id=allowance.bidder_id
  where allowance.bid_year_id=year_id and allowance.bidder_id=bidder_to_review;
  if day_hours is null or day_hours <= 0 or base_hours is null then
    raise exception 'Cannot approve: bidder leave allowance is unavailable.';
  end if;
  select coalesce(sum(request.charged_days),0)*day_hours into used_hours
  from public.leave_requests request where request.bid_year_id=year_id
    and request.bidder_id=bidder_to_review and request.status in ('pending','approved');
  if round_no >= 4 then credit_days := private.round_four_credit_days(year_id,bidder_to_review); end if;
  if used_hours > ceil(base_hours::numeric/day_hours)::integer*day_hours + credit_days*day_hours then
    raise exception 'Cannot approve: pending bids exceed the bidder''s personal leave allowance. Approval override is only available in Rounds 4–6 when enabled.';
  end if;
end
$$;
revoke all on function private.assert_leave_approval_allowance(uuid,uuid,integer) from public,anon,authenticated;

do $upgrade$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure);
  definition := replace(definition,
    'actor.id is null or actor.role not in (''admin'', ''intake'')', 'actor.id is null');
  if position('private.can_review_intake_year(submission.bid_year_id)' in definition)=0 then
    definition := replace(definition, 'if submission.status <> ''pending'' then',
      'if not private.can_review_intake_year(submission.bid_year_id) then
        raise exception ''Bidding reviewer access is required.'';
      end if;
      if submission.status <> ''pending'' then');
  end if;
  if position('private.assert_leave_approval_allowance(' in definition)=0 then
    anchor := 'select * into strict leave_row from public.leave_requests where id = submission.leave_request_id for update;';
    if position(anchor in definition)=0 then raise exception 'Leave approval validation anchor missing.'; end if;
    definition := replace(definition,anchor,anchor || '
      if decision = ''approved'' then
        perform private.assert_leave_approval_allowance(submission.bid_year_id, target.id, leave_row.round_number);
      end if;');
  end if;
  execute definition;
  -- Group reviews use the same year-specific reviewer check and call the
  -- single-review function for each member in the existing atomic transaction.
  if to_regprocedure('public.review_leave_submission_group(uuid[],text,text)') is not null then
    definition := pg_get_functiondef('public.review_leave_submission_group(uuid[],text,text)'::regprocedure);
    definition := replace(definition,
      'actor.id is null or actor.role not in (''admin'', ''intake'')','actor.id is null');
    if position('private.can_review_intake_year(member.bid_year_id)' in definition)=0 then
      anchor := 'member_count := member_count + 1;';
      if position(anchor in definition)=0 then raise exception 'Group review validation anchor missing.'; end if;
      definition := replace(definition,anchor,anchor || '
        if not private.can_review_intake_year(member.bid_year_id) then
          raise exception ''Bidding reviewer access is required.'';
        end if;');
    end if;
    execute definition;
  end if;
end
$upgrade$;
notify pgrst, 'reload schema';
commit;
