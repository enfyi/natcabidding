-- Keep an immutable audit snapshot whenever an RDO submission replaces or
-- edits an earlier bid. Current assignments and exports continue to read the
-- live rdo_lines row; this history is exposed only through the intake queue.
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
      'changeSource', old.change_source
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
    'changeSource', new.change_source
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

create or replace function public.read_bidding_state(requested_bid_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  year_id uuid;
  result jsonb;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email') and active;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;
  select id into strict year_id from public.bid_years where bid_year = requested_bid_year;

  select jsonb_build_object(
    'submissions', coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'type', case when s.submission_type = 'rdo' then 'RDO Line' else 'Leave' end,
      'status', initcap(s.status), 'round', s.round_number, 'area', a.name,
      'name', b.first_name || ' ' || b.last_name, 'initials', b.initials,
      'bidderId', b.id, 'bidAs', b.bid_role, 'seniority', b.seniority_rank,
      'submittedAt', s.submitted_at, 'reviewedAt', s.reviewed_at,
      'reviewedBy', reviewer.initials, 'denialReason', s.denial_reason,
      'requestId', s.leave_request_id,
      'line', rl.line_code, 'range', case
        when lr.id is null then null
        when lr.requested_end_date = lr.requested_start_date then to_char(lr.requested_start_date, 'Mon FMDD, YYYY')
        when extract(year from lr.requested_start_date) = extract(year from lr.requested_end_date) then
          to_char(lr.requested_start_date, 'Mon FMDD') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
        else to_char(lr.requested_start_date, 'Mon FMDD, YYYY') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
      end,
      'days', lr.charged_days, 'priority', lr.priority,
      'isGhostBid', s.is_ghost_bid, 'payload', s.payload,
      'isChange', s.is_change,
      'supersedesSubmissionId', s.supersedes_submission_id,
      'originalBid', s.original_bid,
      'changeSource', s.change_source,
      'changeEnteredBy', change_actor.initials
    ) order by s.submitted_at desc), '[]'::jsonb)
  ) into result
  from public.intake_submissions s
  left join public.bidders b on b.id = s.bidder_id
  left join public.areas a on a.id = s.area_id
  left join public.bidders reviewer on reviewer.id = s.reviewed_by
  left join public.bidders change_actor on change_actor.id = s.change_actor_id
  left join public.rdo_lines rl on rl.id = s.rdo_line_id
  left join public.leave_requests lr on lr.id = s.leave_request_id
  where s.bid_year_id = year_id
    and s.submission_type in ('rdo', 'leave')
    and (actor.role in ('admin', 'intake') or s.area_id = actor.area_id)
    and (actor.role in ('admin', 'intake') or s.bidder_id = actor.id);

  return coalesce(result, jsonb_build_object('submissions', '[]'::jsonb));
end;
$function$;

revoke all on function public.read_bidding_state(integer) from public, anon;
grant execute on function public.read_bidding_state(integer) to authenticated;

commit;
