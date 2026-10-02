-- Preserve installed bidding rules while adding the pilot round policy to the
-- two legacy submission functions that still check scheduled windows directly.
create or replace function private.pilot_round_bypasses_window(target_year uuid, target_round integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  settings public.bid_year_settings%rowtype;
  actor public.bidders%rowtype;
begin
  select * into settings from public.bid_year_settings s where s.bid_year_id = target_year for share;
  if not coalesce(settings.pilot_database, false) then return false; end if;
  select * into actor from public.bidders b
  where b.auth_user_id = auth.uid() and lower(b.email) = lower(auth.jwt() ->> 'email') and b.active;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;
  if not settings.pilot_enabled then raise exception 'Practice bidding is currently turned off.'; end if;
  if actor.role not in ('admin', 'intake') and not exists (
    select 1 from public.bid_year_pilot_members m where m.bid_year_id = target_year and m.bidder_id = actor.id
  ) then raise exception 'Your account is not included in the current bidding pilot.'; end if;
  if target_round is null or target_round not between 1 and 6 then
    raise exception 'Choose a pilot bidding round from 1 through 6.';
  end if;
  if not target_round = any(settings.pilot_open_rounds) then
    raise exception 'Pilot Round % is turned off by an administrator.', target_round;
  end if;
  return true;
end;
$$;
revoke all on function private.pilot_round_bypasses_window(uuid, integer) from public, anon, authenticated;

-- Reinstall this guard because older pilot databases may never have installed
-- the migration that forces scheduled-window enforcement off.
create or replace function private.disable_pilot_bid_window_enforcement()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(new.pilot_database, false) then new.enforce_bid_windows := false; end if;
  return new;
end;
$$;
revoke all on function private.disable_pilot_bid_window_enforcement() from public, anon, authenticated;
drop trigger if exists disable_pilot_bid_window_enforcement on public.bid_year_settings;
create trigger disable_pilot_bid_window_enforcement before insert or update on public.bid_year_settings
for each row execute function private.disable_pilot_bid_window_enforcement();
update public.bid_year_settings set enforce_bid_windows = false where pilot_database;

do $upgrade$
declare
  definition text;
  signature text;
  original_block text;
  replacement_block text;
begin
  foreach signature in array array[
    'public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)',
    'private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)'
  ] loop
    definition := pg_get_functiondef(to_regprocedure(signature));
    if definition is null then raise exception 'Required bidding function is missing: %', signature; end if;
    if position('private.pilot_round_bypasses_window(' in definition) > 0 then continue; end if;
    if signature like 'public.submit_rdo_bid%' then
      original_block := '  if manual_entry then';
      replacement_block := '  if private.pilot_round_bypasses_window(year_row.id, requested_round) then
    resolved_round := requested_round;
  elsif manual_entry then';
    else
      original_block := '  if not manual_entry and not exists (';
      replacement_block := '  if not manual_entry
     and not private.pilot_round_bypasses_window(year_row.id, batch_round)
     and not exists (';
    end if;
    if position(original_block in definition) = 0 then
      raise exception 'Unrecognized bidding function window check: %', signature;
    end if;
    execute replace(definition, original_block, replacement_block);
  end loop;
end;
$upgrade$;
