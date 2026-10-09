-- Published ghost-line labels only; private submissions remain protected.
create or replace function public.read_public_ghost_rdo_bids(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'line', line.line_code, 'area', area.name, 'initials', bidder.initials
  ) order by area.display_order, line.line_code, bidder.seniority_rank), '[]'::jsonb)
  from public.intake_submissions submission
  join public.bid_years year on year.id = submission.bid_year_id
  join public.bidders bidder on bidder.id = submission.bidder_id
  join public.rdo_lines line on line.id = submission.rdo_line_id
  join public.areas area on area.id = line.area_id
  where year.bid_year = requested_bid_year
    and submission.submission_type = 'rdo'
    and submission.status = 'approved'
    and (submission.is_ghost_bid or bidder.bid_role = 'GL')
    and bidder.active;
$$;
revoke all on function public.read_public_ghost_rdo_bids(integer) from public, anon, authenticated;
grant execute on function public.read_public_ghost_rdo_bids(integer) to anon, authenticated;
