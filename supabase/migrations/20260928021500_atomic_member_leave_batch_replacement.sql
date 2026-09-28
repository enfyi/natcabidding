-- Atomically replace one or more bidder-owned leave requests from the
-- responsive Change Bid Dates modal. Apply after the member leave management,
-- replacement, and unchanged-rebid functions.

create or replace function private.reject_unchanged_leave_rebid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status <> 'pending' or auth.uid() is null then
    return new;
  end if;

  -- The batch replacement endpoint deliberately resubmits every date in a
  -- moved Round 1 week, including any date that did not change.
  if coalesce(current_setting('zla.leave_replacement', true), '') = 'on' then
    return new;
  end if;

  if not exists (
    select 1 from public.bidders bidder
    where bidder.id = new.bidder_id
      and bidder.auth_user_id = auth.uid()
      and lower(bidder.email) = lower(auth.jwt() ->> 'email')
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.leave_requests old_request
    join public.audit_events event
      on event.entity_table = 'leave_requests'
     and event.entity_id = old_request.id
     and event.event_type = 'member_leave_request_cancelled'
    where old_request.bid_year_id = new.bid_year_id
      and old_request.bidder_id = new.bidder_id
      and old_request.round_number = new.round_number
      and old_request.status = 'cancelled'
      and old_request.requested_start_date = new.requested_start_date
      and old_request.requested_end_date = new.requested_end_date
  ) then
    raise exception 'These are the same dates you removed in this round. Choose different dates before submitting a new batch.';
  end if;

  return new;
end;
$function$;

create or replace function public.replace_own_leave_request_batch(
  requested_leave_request_ids uuid[],
  replacement_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  request_row public.leave_requests%rowtype;
  requested_bid_year integer;
  requested_bid_year_id uuid;
  requested_round integer;
  requested_id uuid;
  matched_request_count integer;
  submission_result jsonb;
begin
  if requested_leave_request_ids is null
     or cardinality(requested_leave_request_ids) = 0 then
    raise exception 'Choose at least one submitted leave request to change.';
  end if;
  if replacement_items is null
     or jsonb_typeof(replacement_items) <> 'array'
     or jsonb_array_length(replacement_items) = 0 then
    raise exception 'Choose at least one replacement date.';
  end if;
  if cardinality(requested_leave_request_ids) <> (
    select count(distinct value)::integer
    from unnest(requested_leave_request_ids) requested(value)
  ) then
    raise exception 'A submitted leave request can only be replaced once.';
  end if;

  select bidder.*
  into actor
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  for update;

  if actor.id is null then
    raise exception 'Authenticated bidder profile required.';
  end if;

  select count(*)::integer
  into matched_request_count
  from public.leave_requests request
  where request.id = any(requested_leave_request_ids)
    and request.bidder_id = actor.id;

  if matched_request_count <> cardinality(requested_leave_request_ids) then
    raise exception 'One or more leave requests were not found.';
  end if;

  -- Lock and validate the complete set before cancelling anything.
  for request_row in
    select request.*
    from public.leave_requests request
    where request.id = any(requested_leave_request_ids)
    order by request.id
    for update
  loop
    if request_row.bidder_id <> actor.id then
      raise exception 'One or more leave requests were not found.';
    end if;
    if request_row.status not in ('pending', 'approved') then
      raise exception 'Only pending or approved leave requests can be changed.';
    end if;
    if requested_round is null then
      requested_round := request_row.round_number;
      requested_bid_year_id := request_row.bid_year_id;
      select bid_year.bid_year into strict requested_bid_year
      from public.bid_years bid_year
      where bid_year.id = request_row.bid_year_id;
    elsif request_row.round_number <> requested_round
       or request_row.bid_year_id <> requested_bid_year_id then
      raise exception 'All changed leave requests must be from the same round.';
    end if;
  end loop;

  for requested_id in
    select value from unnest(requested_leave_request_ids) requested(value) order by value
  loop
    perform public.cancel_own_leave_request(requested_id);
  end loop;

  update public.intake_submissions submission
  set status = 'cancelled', updated_at = now()
  where submission.leave_request_id = any(requested_leave_request_ids)
    and submission.status in ('pending', 'approved');

  perform set_config('zla.leave_replacement', 'on', true);
  select public.submit_leave_bid_batch(
    requested_bid_year,
    replacement_items,
    null,
    null,
    false
  ) into submission_result;

  return jsonb_build_object(
    'replaced_leave_request_ids', to_jsonb(requested_leave_request_ids),
    'round_number', requested_round,
    'submission', submission_result
  );
end;
$function$;

revoke all on function public.replace_own_leave_request_batch(uuid[],jsonb)
from public, anon;
grant execute on function public.replace_own_leave_request_batch(uuid[],jsonb)
to authenticated;

comment on function public.replace_own_leave_request_batch(uuid[],jsonb) is
  'Atomically replaces selected bidder-owned leave requests during their open round. Supports whole-week Round 1 changes and individual Round 2-4 date changes.';
