-- Resolve a bid-notification recipient without exposing the service-role key to Vercel.
-- The caller must be authenticated and may only notify themselves, their own area
-- when serving as intake, or any area when serving as an administrator.

create or replace function public.resolve_bid_notification_recipient(
  notification_area text,
  notification_initials text
)
returns table (recipient_email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor bidders%rowtype;
  recipient bidders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select b.*
  into actor
  from bidders b
  where b.auth_user_id = auth.uid()
    and b.active
  limit 1;

  if actor.id is null then
    return;
  end if;

  select b.*
  into recipient
  from bidders b
  join areas a on a.id = b.area_id
  where lower(a.name) = lower(trim(notification_area))
    and upper(b.initials) = upper(trim(notification_initials))
    and b.active
  limit 1;

  if recipient.id is null or recipient.email is null or trim(recipient.email) = '' then
    return;
  end if;

  if actor.id = recipient.id
    or actor.role = 'admin'
    or (actor.role = 'intake' and actor.area_id = recipient.area_id)
  then
    return query select recipient.email;
  end if;
end;
$$;

revoke all on function public.resolve_bid_notification_recipient(text, text) from public;
grant execute on function public.resolve_bid_notification_recipient(text, text) to authenticated;
