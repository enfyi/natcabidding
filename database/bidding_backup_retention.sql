-- For databases where bidding_backups.sql was already installed.
begin;
alter table public.bidding_backup_schedule add column if not exists retention_days integer check (retention_days between 1 and 36500);

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

create or replace function private.run_due_bidding_backup()
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
commit;
