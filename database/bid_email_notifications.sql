-- Resolve a bid-notification recipient without exposing the service-role key to Vercel.
-- The caller must be authenticated. Permanent intake/admin reviewers cover all
-- areas; scheduled reviewers need access to a year containing this bidder's bids.
-- Requires database/intake_review_access.sql for the shared reviewer check.

create or replace function public.resolve_bid_notification_recipient(
  notification_area text,
  notification_initials text
)
returns table (recipient_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  recipient public.bidders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select b.*
  into actor
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.active
  limit 1;

  if actor.id is null then
    return;
  end if;

  select b.*
  into recipient
  from public.bidders b
  join public.areas a on a.id = b.area_id
  where lower(a.name) = lower(trim(notification_area))
    and upper(b.initials) = upper(trim(notification_initials))
    and b.active
  limit 1;

  if recipient.id is null or recipient.email is null or trim(recipient.email) = '' then
    return;
  end if;

  if actor.id = recipient.id
    or actor.role in ('admin', 'intake')
    or exists (
      select 1 from public.intake_submissions submission
      where submission.bidder_id = recipient.id
        and private.can_review_intake_year(submission.bid_year_id)
    )
  then
    return query select recipient.email;
  end if;
end;
$$;

revoke all on function public.resolve_bid_notification_recipient(text, text) from public, anon;
grant execute on function public.resolve_bid_notification_recipient(text, text) to authenticated;
