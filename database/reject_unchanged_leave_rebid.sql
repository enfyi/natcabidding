-- Reject a bidder's exact repeat of dates they removed in the same round.
-- Run after member_leave_request_management.sql and member_leave_request_replacement.sql.

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

  -- Reviewer and administrator entries for another bidder are unaffected.
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

revoke all on function private.reject_unchanged_leave_rebid() from public, anon, authenticated;

drop trigger if exists reject_unchanged_leave_rebid on public.leave_requests;
create trigger reject_unchanged_leave_rebid
before insert on public.leave_requests
for each row execute function private.reject_unchanged_leave_rebid();
