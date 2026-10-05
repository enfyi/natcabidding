-- Run only on a development database after installation. All changes roll back.
begin;
delete from public.bidding_backups;
delete from public.bidding_backup_schedule;
insert into public.bidding_backup_schedule(id, enabled, start_date, end_date, start_time, end_time, interval_minutes, retention_days)
values(true, false, current_date - 100, current_date - 90, '07:00', '17:00', 30, 7);
do $$
declare newest bigint;
begin
  -- All expired: preserve exactly the latest, even outside the capture dates.
  insert into public.bidding_backups(created_at, source, payload) values
    (now() - interval '30 days', 'manual', '{}'),
    (now() - interval '20 days', 'scheduled', '{}');
  select id into newest from public.bidding_backups order by created_at desc, id desc limit 1;
  perform private.run_due_bidding_backup();
  if (select count(*) from public.bidding_backups) <> 1 or not exists(select 1 from public.bidding_backups where id = newest) then
    raise exception 'Most recent expired backup must survive';
  end if;
  -- Age cutoff is strict; exactly seven days and recent backups survive.
  insert into public.bidding_backups(created_at, source, payload) values
    (now() - interval '7 days', 'manual', '{}'),
    (now() - interval '1 day', 'scheduled', '{}');
  perform private.prune_bidding_backups();
  if (select count(*) from public.bidding_backups) <> 2 then raise exception 'Cutoff/recent retention failed'; end if;
  -- Tied timestamps: one newest ID always survives.
  delete from public.bidding_backups;
  insert into public.bidding_backups(created_at, source, payload) values
    (now() - interval '20 days', 'manual', '{}'),
    (now() - interval '20 days', 'manual', '{}');
  select max(id) into newest from public.bidding_backups;
  perform private.prune_bidding_backups();
  if (select count(*) from public.bidding_backups) <> 1 or not exists(select 1 from public.bidding_backups where id = newest) then
    raise exception 'Tied backup protection failed';
  end if;
  -- Blank retention disables deletion.
  update public.bidding_backup_schedule set retention_days = null;
  insert into public.bidding_backups(created_at, source, payload) values(now() - interval '100 days', 'manual', '{}');
  perform private.prune_bidding_backups();
  if (select count(*) from public.bidding_backups) <> 2 then raise exception 'Disabled retention deleted backups'; end if;
  -- Empty history is safe.
  delete from public.bidding_backups;
  update public.bidding_backup_schedule set retention_days = 7;
  perform private.prune_bidding_backups();
end $$;
rollback;
