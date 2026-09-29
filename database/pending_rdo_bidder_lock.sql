-- A bidder cannot replace or create another RDO submission while their own
-- RDO submission is still pending intake review. Intake/admin decisions and
-- reviewer edits remain available.
create or replace function public.enforce_pending_rdo_bidder_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_role text;
begin
  select bidder.id, bidder.role
  into actor_id, actor_role
  from public.bidders bidder
  where bidder.auth_user_id = auth.uid()
    and lower(bidder.email) = lower(auth.jwt() ->> 'email')
    and bidder.active
  limit 1;

  if actor_id is null or actor_role in ('admin', 'intake') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.submission_type = 'rdo'
       and old.status = 'pending'
       and old.bidder_id = actor_id then
      raise exception 'Your RDO bid is awaiting an intake decision. You can submit another change after it is approved or denied.';
    end if;
  elsif tg_op = 'INSERT' then
    if new.submission_type = 'rdo'
       and new.status = 'pending'
       and new.bidder_id = actor_id
       and exists (
         select 1
         from public.intake_submissions submission
         where submission.bid_year_id = new.bid_year_id
           and submission.bidder_id = actor_id
           and submission.submission_type = 'rdo'
           and submission.status = 'pending'
       ) then
      raise exception 'Your RDO bid is awaiting an intake decision. You can submit another change after it is approved or denied.';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_pending_rdo_bidder_lock() from public, anon, authenticated;

drop trigger if exists enforce_pending_rdo_bidder_lock on public.intake_submissions;
create trigger enforce_pending_rdo_bidder_lock
before insert or update on public.intake_submissions
for each row execute function public.enforce_pending_rdo_bidder_lock();
