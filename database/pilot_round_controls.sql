-- Install after pilot_mode.sql. Production settings and schedules are untouched.
alter table public.bid_year_settings
  add column if not exists pilot_open_rounds integer[] not null default '{}'::integer[];

create or replace function public.read_pilot_rounds(requested_bid_year integer)
returns integer[] language sql stable security definer set search_path = '' as $$
  select case when settings.pilot_database then settings.pilot_open_rounds else '{}'::integer[] end
  from public.bid_year_settings settings
  join public.bid_years byear on byear.id = settings.bid_year_id
  where byear.bid_year = requested_bid_year
$$;
revoke all on function public.read_pilot_rounds(integer) from public, anon, authenticated;
grant execute on function public.read_pilot_rounds(integer) to authenticated;

create or replace function public.set_pilot_round(
  requested_bid_year integer, requested_round integer, should_enable boolean
)
returns integer[] language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  target_year uuid;
  enabled_rounds integer[];
begin
  select b.id into actor_id from public.bidders b
  where b.auth_user_id = auth.uid() and lower(b.email) = lower(auth.jwt() ->> 'email')
    and b.role = 'admin' and b.active;
  if actor_id is null then raise exception 'System administrator access is required.'; end if;
  if requested_round is null or requested_round not between 1 and 6 then
    raise exception 'Choose a bidding round from 1 through 6.';
  end if;
  select s.bid_year_id into target_year from public.bid_year_settings s
  join public.bid_years y on y.id = s.bid_year_id
  where y.bid_year = requested_bid_year and s.pilot_database
  for update of s;
  if target_year is null then raise exception 'Round controls require an isolated pilot database.'; end if;
  update public.bid_year_settings s
  set pilot_open_rounds = case when coalesce(should_enable, false)
        then array(select distinct r from unnest(s.pilot_open_rounds || array[requested_round]) r order by r)
        else array_remove(s.pilot_open_rounds, requested_round) end,
      updated_by = actor_id, updated_at = now()
  where s.bid_year_id = target_year
  returning s.pilot_open_rounds into enabled_rounds;
  insert into public.audit_events (bid_year_id, actor_id, event_type, entity_table, entity_id, details)
  values (target_year, actor_id, 'pilot_round_changed', 'bid_year_settings', target_year,
    jsonb_build_object('round', requested_round, 'enabled', coalesce(should_enable, false)));
  return enabled_rounds;
end;
$$;
revoke all on function public.set_pilot_round(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.set_pilot_round(integer, integer, boolean) to authenticated;

create or replace function private.enforce_pilot_round_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  settings public.bid_year_settings%rowtype;
  actor public.bidders%rowtype;
  target_year uuid;
  target_round integer;
begin
  if tg_op = 'DELETE' then
    target_year := old.bid_year_id; target_round := old.round_number;
  else
    target_year := new.bid_year_id; target_round := new.round_number;
  end if;
  select * into settings from public.bid_year_settings s where s.bid_year_id = target_year for share;
  if not coalesce(settings.pilot_database, false) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into actor from public.bidders b
  where b.auth_user_id = auth.uid() and lower(b.email) = lower(auth.jwt() ->> 'email') and b.active;
  -- Reviewers can process existing bids and administrators can reset practice data.
  if tg_op <> 'INSERT' and actor.role in ('admin', 'intake') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;
  if not settings.pilot_enabled then raise exception 'Practice bidding is currently turned off.'; end if;
  if not (target_round = any(settings.pilot_open_rounds)) then
    raise exception 'Pilot Round % is turned off by an administrator.', target_round;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.enforce_pilot_round_access() from public, anon, authenticated;
drop trigger if exists enforce_pilot_leave_round on public.leave_requests;
create trigger enforce_pilot_leave_round before insert or update or delete on public.leave_requests
for each row execute function private.enforce_pilot_round_access();
drop trigger if exists enforce_pilot_intake_round on public.intake_submissions;
create trigger enforce_pilot_intake_round before insert or update or delete on public.intake_submissions
for each row execute function private.enforce_pilot_round_access();
