-- Count all bid workdays against area capacity, including holidays/in-lieu.
-- Personal charged-day allowances and holiday credits remain independent.
create or replace function private.area_leave_balance_days(
  year_id uuid,
  target_area_id uuid,
  target_bucket text
)
returns table (total_days numeric, used_days integer, remaining_days numeric)
language sql
stable
security invoker
set search_path = ''
as $function$
  with eligible_bidders as (
    select bidder.id, bidder.leave_slot_allowance
    from public.bidders bidder
    left join public.bidder_bid_year_settings bidder_settings
      on bidder_settings.bid_year_id = year_id
     and bidder_settings.bidder_id = bidder.id
    where bidder.area_id = target_area_id
      and bidder.active
      and bidder.bid_role not in ('GL', 'ADM', 'NB')
      and not coalesce(bidder_settings.is_ghost_bidder, false)
      and case
        when bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
        else 'cpc'
      end = target_bucket
  ),
  totals as (
    select coalesce(sum(bidder.leave_slot_allowance), 0)::numeric / 8 as total_days
    from eligible_bidders bidder
  ),
  usage as (
    select count(*)::integer as used_days
    from public.leave_requests request
    join eligible_bidders bidder on bidder.id = request.bidder_id
    join public.leave_request_dates request_date on request_date.leave_request_id = request.id
    where not request_date.is_rdo
      and request.bid_year_id = year_id
      and request.status in ('pending', 'approved')
      and not request.is_ghost_bid
  )
  select totals.total_days,
         usage.used_days,
         greatest(totals.total_days - usage.used_days, 0)
  from totals cross join usage
$function$;

revoke all on function private.area_leave_balance_days(uuid, uuid, text)
from public, anon, authenticated;
