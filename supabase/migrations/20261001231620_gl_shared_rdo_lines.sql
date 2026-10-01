-- Allow any number of non-consuming GL bidders to share a canonical RDO line
-- with one CPC/DEV occupant. Keep the real line as the source of truth and
-- expose GL assignments as a separate read-only overlay.

do $upgrade_leave_preflight$
declare
  definition text;
  old_guard constant text := 'elsif not ghost_bid and exists (';
  legacy_guard constant text := $guard$elsif exists (
      select 1
      from public.rdo_lines rl
      where rl.id = submitted_rdo_line_id$guard$;
  upgraded_legacy_guard constant text := $guard$elsif target.bid_role <> 'GL' and exists (
      select 1
      from public.rdo_lines rl
      where rl.id = submitted_rdo_line_id$guard$;
  new_guard constant text := 'elsif target.bid_role <> ''GL'' and not ghost_bid and exists (';
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)'::regprocedure
  );

  if position(new_guard in definition) = 0
     and position(upgraded_legacy_guard in definition) = 0 then
    if position(old_guard in definition) > 0 then
      execute replace(definition, old_guard, new_guard);
    elsif position(legacy_guard in definition) > 0 then
      execute replace(definition, legacy_guard, upgraded_legacy_guard);
    else
      raise exception 'Could not locate the RDO-line availability guard in the leave submitter.';
    end if;
  end if;
end
$upgrade_leave_preflight$;

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
      and (bidder.bid_role = 'GL' or submission.is_ghost_bid)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rdo_line_id', ranked.rdo_line_id,
        'area_id', ranked.area_id,
        'line_code', ranked.line_code,
        'initials', ranked.initials,
        'status', ranked.status
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
  'Returns visible GL RDO overlays. These assignments never occupy or close the canonical RDO line.';
