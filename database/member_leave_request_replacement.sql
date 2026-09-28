-- Atomically replace one bidder-owned leave request during its open round.
-- Apply after member_leave_request_management.sql and holiday_leave_round_rules.sql.

create or replace function public.replace_own_leave_request(
  requested_leave_request_id uuid,
  replacement_start_date date,
  replacement_end_date date,
  replacement_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_request public.leave_requests%rowtype;
  requested_bid_year integer;
  submission_result jsonb;
begin
  if replacement_start_date is null or replacement_end_date is null
     or replacement_end_date < replacement_start_date then
    raise exception 'Choose a valid replacement date range.';
  end if;

  -- This checks ownership and the open round, releases slots, and marks the old
  -- request inactive. A failed new submission rolls all of it back.
  perform public.cancel_own_leave_request(requested_leave_request_id);

  select request.* into strict old_request
  from public.leave_requests request
  where request.id = requested_leave_request_id;

  select year.bid_year into strict requested_bid_year
  from public.bid_years year where year.id = old_request.bid_year_id;

  update public.intake_submissions submission
  set status = 'cancelled', updated_at = now()
  where submission.leave_request_id = requested_leave_request_id
    and submission.status in ('pending', 'approved');

  select public.submit_leave_bid_batch(
    requested_bid_year,
    jsonb_build_array(jsonb_build_object(
      'start_date', replacement_start_date,
      'end_date', replacement_end_date,
      'round', old_request.round_number,
      'notes', coalesce(replacement_notes, old_request.notes, '')
    )),
    null, null, false
  ) into submission_result;

  return jsonb_build_object(
    'replaced_leave_request_id', requested_leave_request_id,
    'submission', submission_result
  );
end;
$function$;

revoke all on function public.replace_own_leave_request(uuid,date,date,text) from public, anon;
grant execute on function public.replace_own_leave_request(uuid,date,date,text) to authenticated;

comment on function public.replace_own_leave_request(uuid,date,date,text) is
  'Atomically replaces a bidder-owned leave request. The old days and week buckets are excluded before validating the new dates and leave allowance.';
