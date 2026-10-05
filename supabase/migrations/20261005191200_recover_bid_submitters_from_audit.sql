-- Restore attribution only when an audit event names the exact submission.
-- Existing roles are used for historical labels; new submissions snapshot roles.
-- Temporarily suspend only the attribution guard while restoring its metadata.
drop trigger if exists capture_bid_submitter on public.intake_submissions;

with attribution as (
  select submission.id, actor.id as actor_id, actor.initials,
    case actor.role when 'admin' then 'admin' when 'intake' then 'intake rep' else 'user' end as label
  from public.intake_submissions submission
  join lateral (
    select event.actor_id
    from public.audit_events event
    where (event.event_type = 'rdo_bid_submitted' and event.entity_id = submission.id)
       or (event.event_type = 'leave_batch_submitted'
           and event.details->'submission_ids' @> jsonb_build_array(submission.id::text))
    order by event.created_at desc, event.id desc
    limit 1
  ) event on true
  join public.bidders actor on actor.id = event.actor_id
  where submission.submission_type in ('rdo', 'leave')
    and not (submission.payload ? 'submittedBy')
)
update public.intake_submissions submission
set payload = submission.payload || jsonb_build_object(
  'submittedBy', attribution.initials,
  'submittedByRole', attribution.label,
  'submittedById', attribution.actor_id
)
from attribution where submission.id = attribution.id;

create trigger capture_bid_submitter
before insert or update on public.intake_submissions
for each row execute function public.capture_bid_submitter();
