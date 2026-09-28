-- Public, read-only bid-window schedule used by the front-page area lists.
-- Contact details and submission data are intentionally excluded.

drop function if exists public.read_public_bid_windows(integer);

create or replace function public.read_public_bid_windows(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bidder_id', bid_window.bidder_id,
        'round_number', bid_window.round_number,
        'opens_at', bid_window.opens_at,
        'closes_at', bid_window.closes_at,
        'status', bid_window.status
      )
      order by area.display_order, bidder.seniority_rank nulls last, bid_window.round_number
    ),
    '[]'::jsonb
  )
  from public.bid_windows bid_window
  join public.bid_years bid_year on bid_year.id = bid_window.bid_year_id
  join public.bidders bidder on bidder.id = bid_window.bidder_id
  join public.areas area on area.id = bidder.area_id
  where bid_year.bid_year = requested_bid_year
    and bidder.active
    and bidder.bid_role not in ('ADM', 'NB');
$$;

revoke all on function public.read_public_bid_windows(integer) from public, anon, authenticated;
grant execute on function public.read_public_bid_windows(integer) to anon, authenticated;

comment on function public.read_public_bid_windows(integer) is
  'Returns the published bid-window schedule for public area bid-time lists without exposing private bidder data.';
