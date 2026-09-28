-- Keep Round 4 holiday credits available on databases that were provisioned
-- before the dedicated Round 4 allowance objects were installed. The live
-- database already uses private.round_four_allowances; the compatibility
-- rewrite below only changes the legacy submitter when its old credit-event-
-- only block is still present.

create or replace function private.round_four_credit_days(
  year_id uuid,
  target_bidder_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $function$
  select (
    select count(distinct day.leave_date)::integer
    from public.leave_request_dates day
    join public.leave_requests request on request.id = day.leave_request_id
    where request.bid_year_id = year_id
      and request.bidder_id = target_bidder_id
      and request.round_number between 1 and 3
      and request.status in ('pending', 'approved')
      and day.charged
      and (day.is_holiday or day.is_holiday_in_lieu)
  ) + (
    select coalesce(sum(event.credit_days), 0)::integer
    from public.leave_credit_events event
    where event.bid_year_id = year_id
      and event.bidder_id = target_bidder_id
      and event.round_number <= 4
      and event.source = 'manual_adjustment'
  )
$function$;

revoke all on function private.round_four_credit_days(uuid, uuid)
from public, anon, authenticated;

do $block$
declare
  function_definition text;
  old_credit_block constant text := $old$if batch_round >= 4 then
    select coalesce(sum(credit.credit_days), 0)::integer
    into available_credit_days
    from public.leave_credit_events credit
    where credit.bid_year_id = year_row.id
      and credit.bidder_id = target.id
      and credit.round_number <= batch_round;
  end if;$old$;
  new_credit_block constant text := $new$if batch_round >= 4 then
    available_credit_days := private.round_four_credit_days(year_row.id, target.id);
  end if;$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)'::regprocedure
  )
  into function_definition;

  if pg_catalog.strpos(function_definition, old_credit_block) > 0 then
    execute pg_catalog.replace(function_definition, old_credit_block, new_credit_block);
  end if;
end
$block$;

create or replace view public.bidder_leave_summary as
select
  year_row.id as bid_year_id,
  bidder.id as bidder_id,
  year_row.annual_leave_allowance_days,
  coalesce((
    select sum(total.charged_days)
    from public.leave_request_totals total
    where total.bid_year_id = year_row.id
      and total.bidder_id = bidder.id
      and total.status in ('pending', 'approved')
  ), 0) as leave_days_bid,
  coalesce((
    select sum(total.holiday_days + total.holiday_in_lieu_days)
    from public.leave_request_totals total
    where total.bid_year_id = year_row.id
      and total.bidder_id = bidder.id
      and total.status in ('pending', 'approved')
  ), 0) as holiday_related_days_bid,
  private.round_four_credit_days(year_row.id, bidder.id)::bigint
    as holiday_credit_days_available
from public.bid_years year_row
cross join public.bidders bidder;

comment on function private.round_four_credit_days(uuid, uuid) is
  'Returns charged Round 1-3 holiday and in-lieu days to the bidder for Round 4.';
