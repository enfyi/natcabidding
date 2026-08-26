-- Consolidate reviewer reads into the existing read policies so Postgres only
-- evaluates one permissive SELECT policy per authenticated table access.

begin;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'bid_rounds',
    'bid_windows',
    'rdo_lines',
    'rdo_line_days',
    'holiday_in_lieu_days',
    'leave_slots',
    'leave_requests',
    'leave_request_dates',
    'leave_request_week_buckets',
    'leave_credit_events',
    'intake_submissions',
    'audit_events'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'reviewers can select ' || target_table,
      target_table
    );
  end loop;
end
$$;

alter policy "users can read audit events in own area"
on public.audit_events
using (
  area_id = public.current_bidder_area_id()
  or public.is_bidder_in_current_area(actor_id)
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read bid windows in own area"
on public.bid_windows
using (
  public.is_bidder_in_current_area(bidder_id)
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read holiday in lieu days in own area"
on public.holiday_in_lieu_days
using (
  public.is_bidder_in_current_area(bidder_id)
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read intake submissions in own area"
on public.intake_submissions
using (
  area_id = public.current_bidder_area_id()
  or public.is_bidder_in_current_area(bidder_id)
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read leave credit events in own area"
on public.leave_credit_events
using (
  public.is_bidder_in_current_area(bidder_id)
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read leave dates in own area"
on public.leave_request_dates
using (
  exists (
    select 1
    from public.leave_requests lr
    where lr.id = leave_request_dates.leave_request_id
      and public.is_bidder_in_current_area(lr.bidder_id)
  )
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read week buckets in own area"
on public.leave_request_week_buckets
using (
  exists (
    select 1
    from public.leave_requests lr
    where lr.id = leave_request_week_buckets.leave_request_id
      and public.is_bidder_in_current_area(lr.bidder_id)
  )
  or (select private.is_current_bidding_reviewer())
);

alter policy "users can read leave requests in own area"
on public.leave_requests
using (
  public.is_bidder_in_current_area(bidder_id)
  or (select private.is_current_bidding_reviewer())
);

commit;
