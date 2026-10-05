-- Treat each bidding round as one ZLA-wide span. Personal BUE windows remain
-- unchanged; this only controls whether intake/admin late entry can target the
-- round after an individual window has closed.

create or replace function public.is_area_bid_round_open(
  requested_bid_year_id uuid,
  requested_area_id uuid,
  requested_round integer,
  checked_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    checked_at >= min(bid_window.opens_at)
    and checked_at < max(bid_window.closes_at),
    false
  )
  from public.bid_windows bid_window
  join public.bidders scheduled_bidder on scheduled_bidder.id = bid_window.bidder_id
  where bid_window.bid_year_id = requested_bid_year_id
    and bid_window.round_number = requested_round
    and scheduled_bidder.active
    and scheduled_bidder.bid_role not in ('ADM', 'NB');
$$;

revoke all on function public.is_area_bid_round_open(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.is_area_bid_round_open(uuid, uuid, integer, timestamptz) to authenticated;

comment on function public.is_area_bid_round_open(uuid, uuid, integer, timestamptz) is
  'Compatibility endpoint that reports the all-area round span, from the first active BUE window through the last; the area argument is retained for existing submission functions.';

-- Keep the published round summary aligned when areas were imported separately.
update public.bid_rounds round_summary
set starts_at = bounds.starts_at,
    ends_at = bounds.ends_at
from (
  select
    bid_window.bid_year_id,
    bid_window.round_number,
    min(bid_window.opens_at) as starts_at,
    max(bid_window.closes_at) as ends_at
  from public.bid_windows bid_window
  join public.bidders scheduled_bidder on scheduled_bidder.id = bid_window.bidder_id
  where scheduled_bidder.active
    and scheduled_bidder.bid_role not in ('ADM', 'NB')
  group by bid_window.bid_year_id, bid_window.round_number
) bounds
where round_summary.bid_year_id = bounds.bid_year_id
  and round_summary.round_number = bounds.round_number;
