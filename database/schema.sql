-- NATCA ZLA annual bidding database starter schema.
-- Designed for Postgres/Supabase, but kept framework-neutral so it can also run on Neon/Vercel Postgres.

create extension if not exists pgcrypto;

create table if not exists bid_years (
  id uuid primary key default gen_random_uuid(),
  bid_year integer not null unique,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'archived')),
  annual_leave_allowance_days integer not null default 0 check (annual_leave_allowance_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists bidders (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  area_id uuid references areas(id) on delete set null,
  first_name text not null,
  last_name text not null,
  initials text,
  initials_verified boolean not null default false,
  initials_updated_at timestamptz,
  email text,
  phone text,
  role text not null default 'controller' check (role in ('controller', 'intake', 'admin')),
  bid_role text not null default 'CPC' check (bid_role in ('CPC', 'GL', 'R-DEV', 'D-DEV')),
  seniority_rank integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bidders_area_initials_idx
  on bidders(area_id, initials)
  where active and initials is not null;

create unique index if not exists bidders_email_unique
  on bidders(lower(email))
  where active and email is not null;

create unique index if not exists bidders_area_seniority_unique
  on bidders(area_id, seniority_rank)
  where active and seniority_rank is not null;

create table if not exists rdo_lines (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  line_code text not null,
  line_type text not null default 'CPC' check (line_type in ('CPC', 'DEV')),
  pattern text not null,
  fatigue_group text check (fatigue_group in ('A', 'B', 'C', 'C only')),
  mid text not null default 'No',
  aws boolean not null default false,
  four_ten boolean not null default false,
  flex boolean not null default false,
  status text not null default 'open' check (status in ('open', 'taken', 'locked')),
  assigned_bidder_id uuid references bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bid_year_id, area_id, line_code)
);

create table if not exists rdo_line_days (
  id uuid primary key default gen_random_uuid(),
  rdo_line_id uuid not null references rdo_lines(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  shift_code text not null,
  is_rdo boolean generated always as (upper(shift_code) = 'RDO') stored,
  unique (rdo_line_id, weekday)
);

create table if not exists bid_rounds (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  label text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'open', 'closed')),
  created_at timestamptz not null default now(),
  unique (bid_year_id, round_number)
);

create table if not exists bid_windows (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  bidder_id uuid not null references bidders(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'open', 'closed', 'missed')),
  created_at timestamptz not null default now(),
  unique (bid_year_id, bidder_id, round_number),
  check (closes_at > opens_at)
);

create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  is_observed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bid_year_id, holiday_date, name)
);

create table if not exists holiday_in_lieu_days (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  bidder_id uuid not null references bidders(id) on delete cascade,
  holiday_id uuid not null references holidays(id) on delete cascade,
  in_lieu_date date not null,
  source_rdo_line_id uuid references rdo_lines(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bid_year_id, bidder_id, holiday_id)
);

create table if not exists leave_slots (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  slot_date date not null,
  slot_group text not null check (slot_group in ('cpc', 'dev')),
  slot_code text not null,
  bidder_id uuid references bidders(id) on delete set null,
  slot_initials text,
  status text not null default 'open' check (status in ('open', 'preview', 'pending', 'approved', 'held', 'unavailable')),
  source_leave_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bid_year_id, area_id, slot_date, slot_group, slot_code)
);

create index if not exists leave_slots_date_idx on leave_slots(bid_year_id, area_id, slot_date);
create index if not exists leave_slots_bidder_idx on leave_slots(bidder_id) where bidder_id is not null;

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  bidder_id uuid not null references bidders(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  priority integer not null check (priority > 0),
  leave_type text not null default 'Annual Leave',
  status text not null default 'draft' check (status in ('draft', 'preview', 'pending', 'approved', 'denied', 'cancelled')),
  requested_start_date date,
  requested_end_date date,
  charged_days integer not null default 0 check (charged_days >= 0),
  holiday_credit_days_used integer not null default 0 check (holiday_credit_days_used >= 0),
  notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references bidders(id) on delete set null,
  denial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bid_year_id, bidder_id, round_number, priority)
);

create index if not exists leave_requests_bidder_idx
  on leave_requests(bid_year_id, bidder_id, round_number, status);

create table if not exists leave_request_week_buckets (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests(id) on delete cascade,
  bucket_start_date date not null,
  bucket_end_date date not null,
  created_at timestamptz not null default now(),
  unique (leave_request_id, bucket_start_date, bucket_end_date),
  check (bucket_end_date >= bucket_start_date),
  check (bucket_end_date <= bucket_start_date + 6)
);

create table if not exists leave_request_dates (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests(id) on delete cascade,
  week_bucket_id uuid references leave_request_week_buckets(id) on delete set null,
  leave_date date not null,
  charged boolean not null default true,
  is_rdo boolean not null default false,
  is_holiday boolean not null default false,
  is_holiday_in_lieu boolean not null default false,
  created_at timestamptz not null default now(),
  unique (leave_request_id, leave_date)
);

create index if not exists leave_request_dates_date_idx on leave_request_dates(leave_date);

create table if not exists leave_credit_events (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  bidder_id uuid not null references bidders(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  credit_date date not null,
  credit_days integer not null default 1 check (credit_days > 0),
  source text not null check (source in ('holiday', 'holiday_in_lieu', 'manual_adjustment')),
  source_leave_request_id uuid references leave_requests(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists intake_submissions (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid not null references bid_years(id) on delete cascade,
  area_id uuid references areas(id) on delete set null,
  bidder_id uuid references bidders(id) on delete set null,
  submission_type text not null check (submission_type in ('rdo', 'leave', 'override', 'help')),
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'denied', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references bidders(id) on delete set null,
  denial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists intake_submissions_queue_idx
  on intake_submissions(bid_year_id, status, submitted_at);

create table if not exists intake_schedules (
  id uuid primary key default gen_random_uuid(),
  area_id uuid references areas(id) on delete set null,
  intake_user_id uuid not null references bidders(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  scope text not null default 'All Areas',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists help_threads (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid references bid_years(id) on delete cascade,
  bidder_id uuid references bidders(id) on delete set null,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists help_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references help_threads(id) on delete cascade,
  sender_id uuid references bidders(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  bid_year_id uuid references bid_years(id) on delete set null,
  area_id uuid references areas(id) on delete set null,
  actor_id uuid references bidders(id) on delete set null,
  event_type text not null,
  entity_table text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_time_idx
  on audit_events(bid_year_id, created_at desc);

create or replace view leave_request_totals as
select
  lr.id as leave_request_id,
  lr.bid_year_id,
  lr.bidder_id,
  lr.round_number,
  lr.status,
  count(lrd.id) filter (where lrd.charged) as charged_days,
  count(lrd.id) filter (where lrd.is_holiday) as holiday_days,
  count(lrd.id) filter (where lrd.is_holiday_in_lieu) as holiday_in_lieu_days,
  count(distinct lrwb.id) as round_one_week_buckets
from leave_requests lr
left join leave_request_dates lrd on lrd.leave_request_id = lr.id
left join leave_request_week_buckets lrwb on lrwb.leave_request_id = lr.id
group by lr.id, lr.bid_year_id, lr.bidder_id, lr.round_number, lr.status;

create or replace view bidder_leave_summary as
select
  bys.id as bid_year_id,
  b.id as bidder_id,
  bys.annual_leave_allowance_days,
  coalesce(sum(lrt.charged_days) filter (where lrt.status in ('pending', 'approved')), 0) as leave_days_bid,
  coalesce(sum(lrt.holiday_days + lrt.holiday_in_lieu_days) filter (where lrt.status in ('pending', 'approved')), 0) as holiday_related_days_bid,
  coalesce(sum(lce.credit_days), 0) as holiday_credit_days_available
from bid_years bys
cross join bidders b
left join leave_request_totals lrt on lrt.bid_year_id = bys.id and lrt.bidder_id = b.id
left join leave_credit_events lce on lce.bid_year_id = bys.id and lce.bidder_id = b.id
group by bys.id, b.id, bys.annual_leave_allowance_days;
