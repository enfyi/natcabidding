-- Install after bid_line_import.sql. Enable Supabase Cron (pg_cron) first.
-- Application-data snapshots, not a replacement for off-site PostgreSQL backups.
begin;
create schema if not exists private;
create table public.bidding_backup_schedule (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  start_date date not null,
  end_date date not null,
  start_time time not null,
  end_time time not null,
  timezone text not null default 'America/Los_Angeles' check (timezone = 'America/Los_Angeles'),
  interval_minutes integer not null check (interval_minutes between 1 and 10080),
  retention_days integer check (retention_days between 1 and 36500),
  last_slot timestamptz,
  check (end_date >= start_date), check (end_time >= start_time)
);
create table public.bidding_backups (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('manual','scheduled')),
  payload jsonb not null
);
alter table public.bidding_backup_schedule enable row level security;
alter table public.bidding_backups enable row level security;
revoke all on public.bidding_backup_schedule, public.bidding_backups from anon, authenticated;
grant select, insert, update on public.bidding_backup_schedule to authenticated;
grant select on public.bidding_backups to authenticated;
create policy backup_schedule_admin on public.bidding_backup_schedule to authenticated
  using (public.is_current_admin()) with check (public.is_current_admin());
create policy backup_read_admin on public.bidding_backups for select to authenticated
  using (public.is_current_admin());

create function private.capture_bidding_backup(backup_source text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; backup_id bigint; query text;
begin
  -- A single SELECT gives all application tables the same MVCC snapshot.
  select string_agg(format('select %L as name, coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) as table_rows from public.%I r', tablename, tablename), ' union all ' order by tablename)
    into query from pg_catalog.pg_tables where schemaname = 'public'
    and tablename not in ('bidding_backups', 'bidding_backup_schedule');
  execute 'select jsonb_object_agg(name, table_rows) from (' || query || ') snapshot_tables' into snapshot;
  insert into public.bidding_backups(source, payload)
    values (backup_source, jsonb_build_object('version', 1, 'captured_at', now(), 'tables', snapshot))
    returning id into backup_id;
  return backup_id;
end $$;
revoke all on function private.capture_bidding_backup(text) from public, anon, authenticated;

create function private.admin_backup_now()
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(public.is_current_admin(), false) then
    raise exception 'System administrator access required';
  end if;
  perform pg_advisory_xact_lock(82461005);
  return private.capture_bidding_backup('manual');
end $$;
revoke all on function private.admin_backup_now() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.admin_backup_now() to authenticated;
create function public.backup_bidding_now()
returns bigint language sql security invoker set search_path = '' as $$
  select private.admin_backup_now();
$$;
revoke all on function public.backup_bidding_now() from public, anon;
grant execute on function public.backup_bidding_now() to authenticated;

create or replace function private.prune_bidding_backups()
returns void language plpgsql security definer set search_path = '' as $$
declare days integer; newest_id bigint;
begin
  -- Share the capture lock: cleanup cannot race with an in-progress backup.
  if not pg_try_advisory_xact_lock(82461005) then return; end if;
  select retention_days into days from public.bidding_backup_schedule where id;
  if days is null then return; end if;
  select id into newest_id from public.bidding_backups
    order by created_at desc, id desc limit 1;
  delete from public.bidding_backups
    where created_at < now() - make_interval(days => days) and id <> newest_id;
end $$;
revoke all on function private.prune_bidding_backups() from public, anon, authenticated;

create function private.run_due_bidding_backup()
returns void language plpgsql security definer set search_path = '' as $$
declare s public.bidding_backup_schedule; local_now timestamp; slot timestamptz; minutes integer;
begin
  if not pg_try_advisory_xact_lock(82461005) then return; end if;
  -- Retention runs even when automatic capture is disabled or outside its window.
  perform private.prune_bidding_backups();
  select * into s from public.bidding_backup_schedule where id for update;
  if not found or not s.enabled then return; end if;
  local_now := now() at time zone s.timezone;
  if local_now::date not between s.start_date and s.end_date
    or local_now::time not between s.start_time and s.end_time then return; end if;
  minutes := floor(extract(epoch from (local_now - (local_now::date + s.start_time))) / 60);
  slot := (local_now::date + s.start_time + make_interval(mins => (minutes / s.interval_minutes) * s.interval_minutes)) at time zone s.timezone;
  if s.last_slot is not null and s.last_slot >= slot then return; end if;
  perform private.capture_bidding_backup('scheduled');
  update public.bidding_backup_schedule set last_slot = slot where id;
end $$;
revoke all on function private.run_due_bidding_backup() from public, anon, authenticated;
select cron.schedule('zla-bidding-backups', '* * * * *', 'select private.run_due_bidding_backup()');
commit;
