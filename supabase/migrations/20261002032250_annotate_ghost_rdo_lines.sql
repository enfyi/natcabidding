-- Include ghost bidders in the public, non-consuming RDO annotations.
create or replace function public.read_public_gl_rdo_assignments(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with ranked as (
    select
      submission.rdo_line_id,
      submission.area_id,
      line.line_code,
      upper(trim(bidder.initials)) as initials,
      submission.status,
      coalesce(submission.is_ghost_bid, false) as ghost_bid,
      row_number() over (
        partition by submission.bidder_id
        order by
          case submission.status when 'pending' then 0 else 1 end,
          coalesce(submission.submitted_at, submission.updated_at, submission.created_at) desc,
          submission.id desc
      ) as current_rank
    from public.intake_submissions submission
    join public.bid_years bid_year on bid_year.id = submission.bid_year_id
    join public.bidders bidder on bidder.id = submission.bidder_id
    join public.rdo_lines line on line.id = submission.rdo_line_id
    where bid_year.bid_year = requested_bid_year
      and submission.submission_type = 'rdo'
      and submission.status in ('pending', 'approved')
      and bidder.active
      and (bidder.bid_role = 'GL' or coalesce(submission.is_ghost_bid, false))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rdo_line_id', ranked.rdo_line_id,
        'area_id', ranked.area_id,
        'line_code', ranked.line_code,
        'initials', ranked.initials,
        'status', ranked.status,
        'ghost_bid', ranked.ghost_bid
      )
      order by ranked.area_id, ranked.line_code, ranked.initials
    ),
    '[]'::jsonb
  )
  from ranked
  where ranked.current_rank = 1;
$function$;

revoke all on function public.read_public_gl_rdo_assignments(integer)
from public, anon, authenticated;
grant execute on function public.read_public_gl_rdo_assignments(integer)
to anon, authenticated;

comment on function public.read_public_gl_rdo_assignments(integer) is
  'Returns visible GL and ghost RDO overlays. These assignments never occupy or close the canonical RDO line.';
