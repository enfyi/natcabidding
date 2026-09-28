-- Install in both production and pilot databases to make the application pilot-aware.
-- This file does not designate a database as disposable. Apply pilot_seed.sql only
-- to the isolated pilot database to unlock enable/disable and reset controls.

alter table public.bid_year_settings
  add column if not exists pilot_database boolean not null default false,
  add column if not exists pilot_enabled boolean not null default false,
  add column if not exists pilot_name text not null default 'Bidding Pilot',
  add column if not exists pilot_last_reset_at timestamptz;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.bid_year_pilot_members (
  bid_year_id uuid not null references public.bid_years(id) on delete cascade,
  bidder_id uuid not null references public.bidders(id) on delete cascade,
  added_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (bid_year_id, bidder_id)
);

alter table public.bid_year_pilot_members enable row level security;
revoke all on table public.bid_year_pilot_members from anon, authenticated;

create or replace function public.read_pilot_settings(requested_bid_year integer)
returns table (
  bid_year integer,
  pilot_database boolean,
  pilot_enabled boolean,
  pilot_name text,
  pilot_allowed boolean,
  pilot_member_ids uuid[],
  pilot_last_reset_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select b.id, b.role
    from public.bidders b
    where b.auth_user_id = auth.uid()
      and lower(b.email) = lower(auth.jwt() ->> 'email')
      and b.active
    limit 1
  )
  select
    byear.bid_year,
    coalesce(settings.pilot_database, false),
    coalesce(settings.pilot_enabled, false),
    coalesce(settings.pilot_name, 'Bidding Pilot'),
    case
      when not coalesce(settings.pilot_database, false) then true
      when actor.role in ('admin', 'intake') then true
      else coalesce(settings.pilot_enabled, false) and exists (
        select 1
        from public.bid_year_pilot_members member
        where member.bid_year_id = byear.id and member.bidder_id = actor.id
      )
    end,
    case
      when actor.role = 'admin' then coalesce((
        select array_agg(member.bidder_id order by member.bidder_id)
        from public.bid_year_pilot_members member
        where member.bid_year_id = byear.id
      ), '{}'::uuid[])
      else '{}'::uuid[]
    end,
    settings.pilot_last_reset_at
  from public.bid_years byear
  left join public.bid_year_settings settings on settings.bid_year_id = byear.id
  left join actor on true
  where byear.bid_year = requested_bid_year
$$;

revoke all on function public.read_pilot_settings(integer) from public, anon, authenticated;
grant execute on function public.read_pilot_settings(integer) to authenticated;

create or replace function public.set_pilot_mode(
  requested_bid_year integer,
  should_enable boolean,
  requested_pilot_member_ids uuid[] default '{}'::uuid[],
  requested_pilot_name text default 'Bidding Pilot'
)
returns table (
  bid_year integer,
  pilot_database boolean,
  pilot_enabled boolean,
  pilot_name text,
  pilot_allowed boolean,
  pilot_member_ids uuid[],
  pilot_last_reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_bid_year_id uuid;
  invalid_member_count integer;
begin
  select b.id into actor_id
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.role = 'admin'
    and b.active;
  if actor_id is null then raise exception 'System administrator access is required.'; end if;

  select byear.id into strict target_bid_year_id
  from public.bid_years byear where byear.bid_year = requested_bid_year;

  if not exists (
    select 1 from public.bid_year_settings settings
    where settings.bid_year_id = target_bid_year_id and settings.pilot_database
  ) then
    raise exception 'Pilot controls are locked because this is not an isolated pilot database.';
  end if;

  select count(*) into invalid_member_count
  from unnest(coalesce(requested_pilot_member_ids, '{}'::uuid[])) requested_id
  where not exists (
    select 1 from public.bidders b where b.id = requested_id and b.active
  );
  if invalid_member_count > 0 then raise exception 'Every pilot member must be an active bidder.'; end if;

  delete from public.bid_year_pilot_members where bid_year_id = target_bid_year_id;
  insert into public.bid_year_pilot_members (bid_year_id, bidder_id, added_by)
  select target_bid_year_id, requested_id, actor_id
  from unnest(coalesce(requested_pilot_member_ids, '{}'::uuid[])) requested_id
  on conflict do nothing;

  update public.bid_year_settings
  set pilot_enabled = coalesce(should_enable, false),
      pilot_name = coalesce(nullif(trim(requested_pilot_name), ''), 'Bidding Pilot'),
      updated_by = actor_id,
      updated_at = now()
  where bid_year_id = target_bid_year_id;

  insert into public.audit_events (bid_year_id, actor_id, event_type, entity_table, entity_id, details)
  values (
    target_bid_year_id, actor_id, 'pilot_settings_changed', 'bid_year_settings', target_bid_year_id,
    jsonb_build_object('enabled', coalesce(should_enable, false), 'member_count', cardinality(coalesce(requested_pilot_member_ids, '{}'::uuid[])))
  );

  return query select * from public.read_pilot_settings(requested_bid_year);
end;
$$;

revoke all on function public.set_pilot_mode(integer, boolean, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_pilot_mode(integer, boolean, uuid[], text) to authenticated;

create or replace function private.enforce_pilot_write_access()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_bid_year_id uuid := coalesce(new.bid_year_id, old.bid_year_id);
  actor public.bidders%rowtype;
  settings public.bid_year_settings%rowtype;
begin
  select * into actor
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.active
  limit 1;

  select * into settings from public.bid_year_settings s where s.bid_year_id = target_bid_year_id;
  if not coalesce(settings.pilot_database, false) or actor.role in ('admin', 'intake') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;
  if not settings.pilot_enabled then raise exception 'Practice bidding is currently turned off.'; end if;
  if not exists (
    select 1 from public.bid_year_pilot_members member
    where member.bid_year_id = target_bid_year_id and member.bidder_id = actor.id
  ) then
    raise exception 'Your account is not included in the current bidding pilot.';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.enforce_pilot_write_access() from public, anon, authenticated;

drop trigger if exists enforce_pilot_leave_request_writes on public.leave_requests;
create trigger enforce_pilot_leave_request_writes
before insert or update or delete on public.leave_requests
for each row execute function private.enforce_pilot_write_access();

drop trigger if exists enforce_pilot_intake_submission_writes on public.intake_submissions;
create trigger enforce_pilot_intake_submission_writes
before insert or update or delete on public.intake_submissions
for each row execute function private.enforce_pilot_write_access();

create or replace function public.reset_pilot_data(requested_bid_year integer)
returns table (
  bid_year integer,
  pilot_database boolean,
  pilot_enabled boolean,
  pilot_name text,
  pilot_allowed boolean,
  pilot_member_ids uuid[],
  pilot_last_reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_bid_year_id uuid;
begin
  select b.id into actor_id
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.role = 'admin'
    and b.active;
  if actor_id is null then raise exception 'System administrator access is required.'; end if;

  select byear.id into strict target_bid_year_id
  from public.bid_years byear where byear.bid_year = requested_bid_year;
  if not exists (
    select 1 from public.bid_year_settings settings
    where settings.bid_year_id = target_bid_year_id and settings.pilot_database
  ) then
    raise exception 'Reset refused: this is not an isolated pilot database.';
  end if;

  if to_regclass('private.bid_window_email_reminders') is not null then
    execute 'delete from private.bid_window_email_reminders where bid_window_id in (select id from public.bid_windows where bid_year_id = $1)'
    using target_bid_year_id;
  end if;

  update public.leave_slots
  set bidder_id = null,
      slot_initials = null,
      source_leave_request_id = null,
      status = case when status = 'unavailable' then 'unavailable' else 'open' end,
      updated_at = now()
  where bid_year_id = target_bid_year_id;
  delete from public.leave_slots
  where bid_year_id = target_bid_year_id and slot_code like 'OVR-%';

  delete from public.intake_submissions where bid_year_id = target_bid_year_id;
  delete from public.leave_credit_events where bid_year_id = target_bid_year_id;
  delete from public.leave_requests where bid_year_id = target_bid_year_id;
  delete from public.holiday_in_lieu_days where bid_year_id = target_bid_year_id;
  delete from public.help_threads where bid_year_id = target_bid_year_id;
  delete from public.audit_events where bid_year_id = target_bid_year_id;

  update public.rdo_lines
  set status = 'open', assigned_bidder_id = null, assigned_initials = null, updated_at = now()
  where bid_year_id = target_bid_year_id;

  update public.bid_year_settings
  set pilot_enabled = false, pilot_last_reset_at = now(), updated_by = actor_id, updated_at = now()
  where bid_year_id = target_bid_year_id;

  insert into public.audit_events (bid_year_id, actor_id, event_type, entity_table, entity_id, details)
  values (target_bid_year_id, actor_id, 'pilot_data_reset', 'bid_year_settings', target_bid_year_id, '{}'::jsonb);

  return query select * from public.read_pilot_settings(requested_bid_year);
end;
$$;

revoke all on function public.reset_pilot_data(integer) from public, anon, authenticated;
grant execute on function public.reset_pilot_data(integer) to authenticated;
