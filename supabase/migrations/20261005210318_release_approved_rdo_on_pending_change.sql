-- Install RDO change history and release superseded bids atomically.
-- Preserve the current read_bidding_state authorization and attribution.
begin;

alter table public.intake_submissions
  add column if not exists is_change boolean not null default false,
  add column if not exists supersedes_submission_id uuid
    references public.intake_submissions(id) on delete set null,
  add column if not exists original_bid jsonb,
  add column if not exists change_source text
    check (change_source in ('bidder', 'intake')),
  add column if not exists change_actor_id uuid
    references public.bidders(id) on delete set null;

create index if not exists intake_submissions_supersedes_idx
  on public.intake_submissions(supersedes_submission_id)
  where supersedes_submission_id is not null;

create or replace function public.classify_rdo_bid_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  previous_submission public.intake_submissions%rowtype;
  previous_line_code text;
  material_approved_change boolean := false;
  material_pending_edit boolean := false;
begin
  if new.submission_type <> 'rdo' or new.status <> 'pending' then
    return new;
  end if;

  select bidder.* into actor
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  limit 1;

  -- Once a submission is classified, keep the first original snapshot even
  -- if the pending replacement is edited again by the bidder or intake.
  if tg_op = 'UPDATE' and old.is_change then
    new.is_change := true;
    new.supersedes_submission_id := old.supersedes_submission_id;
    new.original_bid := old.original_bid;
    new.change_source := old.change_source;
    new.change_actor_id := old.change_actor_id;
    new.payload := new.payload || jsonb_build_object(
      'isChange', true,
      'changeSource', old.change_source,
      'originalBid', old.original_bid
    );
    return new;
  end if;

  -- A new pending RDO after an approval is a replacement, regardless of
  -- whether the employee submitted it or intake entered it for that employee.
  select submission.* into previous_submission
  from public.intake_submissions submission
  where submission.bid_year_id = new.bid_year_id
    and submission.bidder_id = new.bidder_id
    and submission.submission_type = 'rdo'
    and submission.status = 'approved'
    and submission.id is distinct from new.id
  order by submission.reviewed_at desc nulls last,
    submission.submitted_at desc nulls last,
    submission.created_at desc
  limit 1;

  if previous_submission.id is not null then
    material_approved_change :=
      previous_submission.rdo_line_id is distinct from new.rdo_line_id
      or previous_submission.payload->'fatigueGroup' is distinct from new.payload->'fatigueGroup'
      or previous_submission.payload->'flex' is distinct from new.payload->'flex'
      or previous_submission.payload->'aws' is distinct from new.payload->'aws'
      or previous_submission.payload->'mid' is distinct from new.payload->'mid';
    if not material_approved_change then
      previous_submission.id := null;
    end if;
  end if;

  -- Editing a still-pending first bid is also a change. Preserve the values
  -- that were actually in the queue before the edit overwrites them.
  if tg_op = 'UPDATE' then
    material_pending_edit :=
      old.rdo_line_id is distinct from new.rdo_line_id
      or old.payload->'fatigueGroup' is distinct from new.payload->'fatigueGroup'
      or old.payload->'flex' is distinct from new.payload->'flex'
      or old.payload->'aws' is distinct from new.payload->'aws'
      or old.payload->'mid' is distinct from new.payload->'mid';
    if previous_submission.id is null and material_pending_edit then
      previous_submission := old;
    end if;
  end if;

  if previous_submission.id is null then
    new.is_change := false;
    new.supersedes_submission_id := null;
    new.original_bid := null;
    new.change_source := null;
    new.change_actor_id := null;
    new.payload := new.payload - 'isChange' - 'changeSource';
    return new;
  end if;

  select line.line_code into previous_line_code
  from public.rdo_lines line
  where line.id = previous_submission.rdo_line_id;

  new.is_change := true;
  new.supersedes_submission_id := previous_submission.id;
  new.original_bid := jsonb_build_object(
    'submissionId', previous_submission.id,
    'line', coalesce(previous_line_code, previous_submission.payload->>'line', previous_submission.payload->>'rdo_line_code'),
    'fatigueGroup', coalesce(previous_submission.payload->>'fatigueGroup', previous_submission.payload->>'fatigue_group'),
    'flex', previous_submission.payload->'flex',
    'aws', previous_submission.payload->'aws',
    'mid', previous_submission.payload->'mid',
    'round', previous_submission.round_number,
    'status', previous_submission.status,
    'submittedAt', previous_submission.submitted_at,
    'reviewedAt', previous_submission.reviewed_at
  );
  new.change_source := case
    when actor.role in ('admin', 'intake') then 'intake'
    else 'bidder'
  end;
  new.change_actor_id := actor.id;
  new.payload := new.payload || jsonb_build_object(
    'isChange', true,
    'changeSource', new.change_source,
    'originalBid', new.original_bid
  );
  return new;
end;
$function$;

revoke all on function public.classify_rdo_bid_change()
from public, anon, authenticated;

drop trigger if exists classify_rdo_bid_change on public.intake_submissions;
create trigger classify_rdo_bid_change
before insert or update of bidder_id, bid_year_id, rdo_line_id, submission_type, status, payload
on public.intake_submissions
for each row execute function public.classify_rdo_bid_change();




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




create or replace function private.release_approved_rdo_on_pending_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.submission_type <> 'rdo' or new.status <> 'pending' then
    return new;
  end if;
  -- Intake may update the line reference before writing its approval status.
  -- The prior assignment was already released when this request was submitted.
  if tg_op = 'UPDATE' and old.status = 'pending' then
    return new;
  end if;
  if not new.is_change then
    return new;
  end if;

  -- The existing submission RPC authorizes and locks the bidder before this
  -- internal trigger runs. Do not expose this function as a callable API.
  update public.rdo_lines
  set status = 'open', assigned_bidder_id = null,
      assigned_initials = null, updated_at = now()
  where bid_year_id = new.bid_year_id
    and assigned_bidder_id = new.bidder_id;

  update public.intake_submissions
  set status = 'expired', updated_at = now()
  where bid_year_id = new.bid_year_id
    and bidder_id = new.bidder_id
    and submission_type = 'rdo'
    and status = 'approved'
    and id <> new.id;

  return new;
end;
$function$;

revoke all on function private.release_approved_rdo_on_pending_change()
from public, anon, authenticated;

-- AFTER ensures change classification and Round 1 leave expiration have
-- completed before the previous approval is retired.
drop trigger if exists release_approved_rdo_on_pending_change on public.intake_submissions;
create trigger release_approved_rdo_on_pending_change
  after insert or update of status, rdo_line_id, payload
  on public.intake_submissions
  for each row execute function private.release_approved_rdo_on_pending_change();


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

revoke all on function private.reject_unchanged_leave_rebid() from public, anon, authenticated;

commit;
