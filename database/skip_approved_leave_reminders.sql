-- Apply to existing installations to skip closing reminders after leave approval.
-- Includes already queued reminders and failed delivery retries.

create or replace function public.claim_due_bid_window_email_reminders()
returns table (
  reminder_id uuid,
  reminder_type text,
  recipient_email text,
  recipient_first_name text,
  recipient_initials text,
  area_name text,
  bid_year integer,
  round_number integer,
  opens_at timestamptz,
  closes_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_bid_reminder_secret();

  insert into private.bid_window_email_reminders (bid_window_id, reminder_type, scheduled_for)
  select bw.id, 'opening_15_minutes', bw.opens_at - interval '15 minutes'
  from public.bid_windows bw
  join public.bidders b on b.id = bw.bidder_id
  where bw.status in ('scheduled', 'open')
    and b.active
    and nullif(trim(b.email), '') is not null
    and now() >= bw.opens_at - interval '15 minutes'
    and now() < bw.opens_at
  on conflict on constraint bid_window_email_reminders_bid_window_id_reminder_type_key do nothing;

  insert into private.bid_window_email_reminders (bid_window_id, reminder_type, scheduled_for)
  select bw.id, 'expiring_30_minutes', bw.closes_at - interval '30 minutes'
  from public.bid_windows bw
  join public.bidders b on b.id = bw.bidder_id
  where bw.status in ('scheduled', 'open')
    and b.active
    and nullif(trim(b.email), '') is not null
    and now() >= bw.closes_at - interval '30 minutes'
    and now() < bw.closes_at
    and not exists (
      select 1
      from public.leave_requests lr
      where lr.bid_year_id = bw.bid_year_id
        and lr.bidder_id = bw.bidder_id
        and lr.round_number = bw.round_number
        and lr.status = 'approved'
    )
  on conflict on constraint bid_window_email_reminders_bid_window_id_reminder_type_key do nothing;

  return query
  with candidates as (
    select r.id
    from private.bid_window_email_reminders r
    join public.bid_windows bw on bw.id = r.bid_window_id
    where r.delivered_at is null
      and r.claimed_at is null
      and r.scheduled_for <= now()
      and (
        (r.reminder_type = 'opening_15_minutes' and now() < bw.opens_at)
        or (r.reminder_type = 'expiring_30_minutes' and now() < bw.closes_at
          and not exists (
            select 1
            from public.leave_requests lr
            where lr.bid_year_id = bw.bid_year_id
              and lr.bidder_id = bw.bidder_id
              and lr.round_number = bw.round_number
              and lr.status = 'approved'
          ))
      )
    order by r.scheduled_for, r.id
    limit 50
    for update of r skip locked
  ),
  claimed as (
    update private.bid_window_email_reminders r
    set claimed_at = now(),
        attempts = r.attempts + 1,
        last_error = null
    from candidates c
    where r.id = c.id
    returning r.id, r.bid_window_id, r.reminder_type
  )
  select
    c.id,
    c.reminder_type,
    b.email,
    b.first_name,
    b.initials,
    a.name,
    bys.bid_year,
    bw.round_number,
    bw.opens_at,
    bw.closes_at
  from claimed c
  join public.bid_windows bw on bw.id = c.bid_window_id
  join public.bid_years bys on bys.id = bw.bid_year_id
  join public.bidders b on b.id = bw.bidder_id
  join public.areas a on a.id = b.area_id
  order by bw.opens_at, b.seniority_rank nulls last;
end;
$$;

revoke all on function public.claim_due_bid_window_email_reminders() from public, authenticated, anon;
grant execute on function public.claim_due_bid_window_email_reminders() to anon;

