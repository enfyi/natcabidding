-- Bidders may change an approved RDO during their open window only after all
-- Round 1 leave decisions are complete. The change releases every approved
-- Round 1 leave slot and preserves the old queue entries as Expired history.
begin;

alter table public.leave_requests
  drop constraint if exists leave_requests_status_check;
alter table public.leave_requests
  add constraint leave_requests_status_check
  check (status in ('draft', 'preview', 'pending', 'approved', 'denied', 'cancelled', 'expired'));

alter table public.intake_submissions
  drop constraint if exists intake_submissions_status_check;
alter table public.intake_submissions
  add constraint intake_submissions_status_check
  check (status in ('draft', 'pending', 'approved', 'denied', 'cancelled', 'expired'));

create or replace function public.expire_round_one_leave_after_rdo_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  previous_rdo public.intake_submissions%rowtype;
  affected_request_ids uuid[];
  affected_date date;
begin
  if tg_op <> 'INSERT'
     or new.submission_type <> 'rdo'
     or new.status <> 'pending' then
    return new;
  end if;

  select bidder.*
  into actor
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  limit 1;

  -- Reviewer changes use their existing intake workflow and do not expire a
  -- bidder's leave automatically.
  if actor.id is null
     or actor.role in ('admin', 'intake')
     or new.bidder_id is distinct from actor.id then
    return new;
  end if;

  select submission.*
  into previous_rdo
  from public.intake_submissions submission
  where submission.bid_year_id = new.bid_year_id
    and submission.bidder_id = actor.id
    and submission.submission_type = 'rdo'
    and submission.status = 'approved'
  order by submission.reviewed_at desc nulls last, submission.submitted_at desc
  limit 1
  for update;

  -- This trigger applies only when an approved line is actually replaced.
  if previous_rdo.id is null
     or previous_rdo.rdo_line_id is not distinct from new.rdo_line_id then
    return new;
  end if;

  if exists (
    select 1
    from public.leave_requests request
    where request.bid_year_id = new.bid_year_id
      and request.bidder_id = actor.id
      and request.round_number = 1
      and request.status = 'pending'
  ) then
    raise exception 'Your Round 1 leave dates are awaiting an intake decision. Wait until they are approved or denied before changing your RDO bid.';
  end if;

  select coalesce(array_agg(request.id order by request.id), array[]::uuid[])
  into affected_request_ids
  from public.leave_requests request
  where request.bid_year_id = new.bid_year_id
    and request.bidder_id = actor.id
    and request.round_number = 1
    and request.status = 'approved';

  if cardinality(affected_request_ids) = 0 then
    return new;
  end if;

  perform request.id
  from public.leave_requests request
  where request.id = any(affected_request_ids)
  order by request.id
  for update;

  for affected_date in
    select distinct request_date.leave_date
    from public.leave_request_dates request_date
    where request_date.leave_request_id = any(affected_request_ids)
    order by request_date.leave_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.bid_year_id::text || ':' || actor.area_id::text || ':' ||
        case when actor.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev' else 'cpc' end || ':' ||
        affected_date::text,
        0
      )
    );
  end loop;

  delete from public.leave_slots slot
  where slot.source_leave_request_id = any(affected_request_ids)
    and slot.slot_code like 'OVERRIDE-%';

  update public.leave_slots slot
  set bidder_id = null,
      slot_initials = null,
      status = 'open',
      source_leave_request_id = null,
      updated_at = now()
  where slot.source_leave_request_id = any(affected_request_ids);

  delete from public.leave_credit_events credit
  where credit.source_leave_request_id = any(affected_request_ids);

  update public.leave_requests request
  set status = 'expired',
      updated_at = now()
  where request.id = any(affected_request_ids);

  update public.intake_submissions submission
  set status = 'expired',
      payload = submission.payload || jsonb_build_object(
        'expiry_reason', 'RDO line changed by bidder',
        'expired_at', now()
      ),
      updated_at = now()
  where submission.leave_request_id = any(affected_request_ids)
    and submission.status = 'approved';

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  )
  select
    new.bid_year_id,
    actor.area_id,
    actor.id,
    'round_one_leave_expired_after_rdo_change',
    'leave_requests',
    request.id,
    jsonb_build_object(
      'previous_rdo_line_id', previous_rdo.rdo_line_id,
      'new_rdo_line_id', new.rdo_line_id,
      'previous_status', 'approved',
      'round_number', 1
    )
  from public.leave_requests request
  where request.id = any(affected_request_ids);

  return new;
end;
$function$;

revoke all on function public.expire_round_one_leave_after_rdo_change()
from public, anon, authenticated;

drop trigger if exists expire_round_one_leave_after_rdo_change
on public.intake_submissions;
create trigger expire_round_one_leave_after_rdo_change
before insert on public.intake_submissions
for each row execute function public.expire_round_one_leave_after_rdo_change();

-- Pending leave is immutable to the bidder. Intake/admin can still approve,
-- deny, edit, or override it.
create or replace function public.enforce_pending_leave_bidder_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  actor_role text;
begin
  if old.status <> 'pending' or new.status = old.status then
    return new;
  end if;

  select bidder.id, bidder.role
  into actor_id, actor_role
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  limit 1;

  if actor_id = old.bidder_id and actor_role not in ('admin', 'intake') then
    raise exception 'Your leave dates are awaiting an intake decision. Wait until they are approved or denied before changing them.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_pending_leave_bidder_lock()
from public, anon, authenticated;

drop trigger if exists enforce_pending_leave_bidder_lock
on public.leave_requests;
create trigger enforce_pending_leave_bidder_lock
before update on public.leave_requests
for each row execute function public.enforce_pending_leave_bidder_lock();

commit;
