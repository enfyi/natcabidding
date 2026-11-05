-- Apply after the leave submitter and ghost-bidding installers. All ordinary
-- bidder/manual submissions reach this private writer after authentication and
-- input validation. Preserve existing round, window, and approval policies.
begin;

-- Match the browser: round each eligible bidder's hours up to eight-hour area
-- days, count pending and approved workdays (including holidays), exclude GL
-- and ghost leave, and keep CPC/DEV budgets separate.
create or replace function private.area_leave_balance_days(
  year_id uuid, target_area_id uuid, target_bucket text
)
returns table (total_days numeric, used_days integer, remaining_days numeric)
language sql stable security invoker set search_path = ''
as $function$
  with eligible_bidders as (
    select bidder.id, bidder.leave_slot_allowance
    from public.bidders bidder
    left join public.bidder_bid_year_settings settings
      on settings.bid_year_id = year_id and settings.bidder_id = bidder.id
    where bidder.area_id = target_area_id and bidder.active
      and bidder.bid_role not in ('GL', 'ADM', 'NB')
      and not coalesce(settings.is_ghost_bidder, false)
      and case when bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT')
        then 'dev' else 'cpc' end = target_bucket
  ), totals as (
    select coalesce(sum(ceil(bidder.leave_slot_allowance::numeric / 8)), 0) as total_days
    from eligible_bidders bidder
  ), usage as (
    select count(*)::integer as used_days
    from public.leave_requests request
    join eligible_bidders bidder on bidder.id = request.bidder_id
    join public.leave_request_dates request_date on request_date.leave_request_id = request.id
    where request.bid_year_id = year_id and request.status in ('pending', 'approved')
      and not request.is_ghost_bid and not request_date.is_rdo
  )
  select totals.total_days, usage.used_days,
    greatest(totals.total_days - usage.used_days, 0)
  from totals cross join usage
$function$;
revoke all on function private.area_leave_balance_days(uuid, uuid, text)
from public, anon, authenticated;

create or replace function private.assert_area_leave_capacity(
  year_id uuid, target_bidder_id uuid, requested_dates date[], rdo_line_id uuid
)
returns void
language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  target public.bidders%rowtype;
  bucket text;
  area_name text;
  balance record;
  requested_days integer;
  non_consuming_bid boolean;
begin
  select bidder.* into strict target from public.bidders bidder where bidder.id = target_bidder_id;
  -- GL and flagged ghost bidders consume no area days, but both must stop
  -- submitting leave when their applicable area bucket is exhausted.
  non_consuming_bid := target.bid_role = 'GL' or public.is_ghost_bidder(year_id, target.id);
  bucket := case when target.bid_role = 'GL' then private.gl_leave_bucket(year_id, target.id)
    when target.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev' else 'cpc' end;

  -- A date-only lock does not protect the annual balance when bids use different
  -- dates. Hold one lock per year/area/bucket until the enclosing save commits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'area-leave-balance:' || year_id::text || ':' || target.area_id::text || ':' || bucket, 0));
  -- Read in a separate statement after waiting, so committed reservations from
  -- the previous holder are visible at the API's READ COMMITTED isolation level.
  select * into strict balance from private.area_leave_balance_days(year_id, target.area_id, bucket);
  select area.name into strict area_name from public.areas area where area.id = target.area_id;

  select count(distinct requested.leave_date)::integer into requested_days
  from unnest(requested_dates) requested(leave_date)
  where not exists (
    select 1 from public.rdo_line_days day
    where day.rdo_line_id = assert_area_leave_capacity.rdo_line_id
      and day.weekday = extract(dow from requested.leave_date)::smallint and day.is_rdo
  );

  if (non_consuming_bid and balance.remaining_days <= 0)
     or (not non_consuming_bid and balance.used_days + requested_days > balance.total_days) then
    raise exception '% % leave balance is exhausted (% used of % estimated days). This selection requires % additional area days.',
      area_name, upper(bucket), balance.used_days, balance.total_days,
      case when non_consuming_bid then 0 else requested_days end;
  end if;
end
$function$;
revoke all on function private.assert_area_leave_capacity(uuid, uuid, date[], uuid)
from public, anon, authenticated;

-- Patch the shared writer without replacing newer auth/window/round fixes.
-- Fail rather than silently installing an unenforced or incompatible version.
do $install$
declare
  definition text;
  anchor constant text := '  select coalesce(max(priority), 0) into priority_no from public.leave_requests';
  guard constant text := '  perform private.assert_area_leave_capacity(year_row.id, target.id, all_dates, effective_rdo_line_id);';
begin
  select pg_catalog.pg_get_functiondef(
    'private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)'::regprocedure
  ) into definition;
  if position(guard in definition) = 0 then
    if position(anchor in definition) = 0
       or position('all_dates date[]' in definition) = 0
       or position('effective_rdo_line_id uuid' in definition) = 0 then
      raise exception 'Could not locate the shared leave writer area-capacity validation point.';
    end if;
    definition := replace(definition, anchor, guard || E'\n\n' || anchor);
    execute definition;
  end if;
end
$install$;
commit;
