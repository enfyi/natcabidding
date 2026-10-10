-- Resolve GL leave classification from its selected RDO line, retaining GL rules.
create or replace function private.gl_leave_bucket(year_id uuid, bidder_id uuid)
returns text language sql stable security invoker set search_path = ''
as $function$
  select coalesce((
    select case when line.line_type = 'DEV' then 'dev' else 'cpc' end
    from public.intake_submissions submission
    join public.bidders bidder on bidder.id = submission.bidder_id
    join public.rdo_lines line on line.bid_year_id = submission.bid_year_id
      and line.area_id = bidder.area_id
      and (line.id = submission.rdo_line_id or line.line_code = coalesce(
        nullif(submission.payload->>'rdo_line_code', ''),
        nullif(submission.payload->>'line', '')))
    where submission.bid_year_id = $1 and submission.bidder_id = $2
      and submission.submission_type = 'rdo'
      and submission.status in ('approved', 'pending')
    order by (submission.status = 'approved') desc,
      submission.reviewed_at desc nulls last, submission.submitted_at desc, submission.id
    limit 1
  ), 'cpc');
$function$;
revoke all on function private.gl_leave_bucket(uuid, uuid) from public, anon, authenticated;

-- Extend existing routines in place so their authorization and capacity rules
-- remain intact. Each routine supplies its own bid year to the shared resolver.
do $upgrade$
declare
  routine record;
  definition text;
  upgraded text;
  year_expression text;
  bidder_alias text;
  marker text;
begin
  for routine in
    select p.oid, p.proname, n.nspname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('submit_leave_bid_batch', 'review_bidding_submission'))
       or (n.nspname = 'private' and p.proname in (
         'sync_holiday_leave_slots', 'validate_ghost_leave_date',
         'replace_bidder_editor_leave_dates', 'replace_approved_leave_request_dates_unchecked',
         'save_bidder_editor'))
  loop
    definition := pg_catalog.pg_get_functiondef(routine.oid);
    if position('private.gl_leave_bucket(' in definition) > 0 then continue; end if;
    year_expression := case routine.proname
      when 'submit_leave_bid_batch' then 'year_row.id'
      when 'review_bidding_submission' then 'submission.bid_year_id'
      when 'save_bidder_editor' then 'year_id'
      else 'request_row.bid_year_id' end;
    bidder_alias := case when routine.proname in ('sync_holiday_leave_slots', 'validate_ghost_leave_date')
      then 'bidder_row' else 'target' end;
    marker := 'when ' || bidder_alias || '.bid_role in';
    upgraded := replace(definition, marker,
      'when ' || bidder_alias || '.bid_role = ''GL'' then private.gl_leave_bucket('
      || year_expression || ', ' || bidder_alias || '.id) ' || marker);
    if upgraded = definition then
      raise exception 'Missing leave category anchor in %.%', routine.nspname, routine.proname;
    end if;
    execute upgraded;
  end loop;
end;
$upgrade$;
