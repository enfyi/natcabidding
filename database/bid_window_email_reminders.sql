-- Scheduled email reminders for annual bid windows.
-- Supabase Cron calls the protected Vercel route once per minute. The route
-- claims due reminders through the two narrowly scoped RPC functions below.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.bid_window_email_reminders (
  id uuid primary key default gen_random_uuid(),
  bid_window_id uuid not null references public.bid_windows(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('opening_15_minutes', 'expiring_30_minutes')),
  scheduled_for timestamptz not null,
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  unique (bid_window_id, reminder_type)
);

alter table private.bid_window_email_reminders enable row level security;

create index if not exists bid_window_email_reminders_due_idx
  on private.bid_window_email_reminders(scheduled_for)
  where delivered_at is null and claimed_at is null;

create or replace function private.require_bid_reminder_secret()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  request_headers jsonb;
  supplied_secret text;
  configured_secret text;
begin
  request_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  supplied_secret := request_headers ->> 'x-bid-reminder-secret';

  select decrypted_secret
  into configured_secret
  from vault.decrypted_secrets
  where name = 'bid_reminder_cron_secret'
  limit 1;

  if configured_secret is null
    or length(configured_secret) < 32
    or supplied_secret is null
    or extensions.digest(supplied_secret, 'sha256') <> extensions.digest(configured_secret, 'sha256')
  then
    raise exception using errcode = '42501', message = 'Bid reminder authorization failed.';
  end if;
end;
$$;

revoke all on function private.require_bid_reminder_secret() from public, anon, authenticated;

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
        or (r.reminder_type = 'expiring_30_minutes' and now() < bw.closes_at)
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

create or replace function public.complete_bid_window_email_reminder(
  reminder_id uuid,
  delivered boolean,
  delivery_error text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  changed boolean;
begin
  perform private.require_bid_reminder_secret();

  update private.bid_window_email_reminders r
  set delivered_at = case when delivered then now() else null end,
      claimed_at = case when delivered then r.claimed_at else null end,
      last_error = case when delivered then null else left(coalesce(delivery_error, 'Unknown delivery error.'), 1000) end
  where r.id = reminder_id
    and r.delivered_at is null;

  changed := found;
  return changed;
end;
$$;

revoke all on function public.complete_bid_window_email_reminder(uuid, boolean, text) from public, authenticated, anon;
grant execute on function public.complete_bid_window_email_reminder(uuid, boolean, text) to anon;

create or replace function private.dispatch_bid_window_email_reminders()
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  endpoint text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into endpoint
  from vault.decrypted_secrets
  where name = 'bid_reminder_endpoint'
  limit 1;

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'bid_reminder_cron_secret'
  limit 1;

  if endpoint is null or cron_secret is null then
    return null;
  end if;

  select net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := jsonb_build_object('scheduled_at', now()),
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.dispatch_bid_window_email_reminders() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'send-bid-window-email-reminders'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'send-bid-window-email-reminders',
    '* * * * *',
    $job$select private.dispatch_bid_window_email_reminders();$job$
  );
end;
$$;
