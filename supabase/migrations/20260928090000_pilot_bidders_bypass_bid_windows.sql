-- Pilot participants are selected explicitly and protected by the pilot write
-- guard. Their practice bids should not also depend on scheduled bid windows.

create or replace function private.disable_pilot_bid_window_enforcement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(new.pilot_database, false) then
    new.enforce_bid_windows := false;
  end if;
  return new;
end;
$$;

revoke all on function private.disable_pilot_bid_window_enforcement() from public, anon, authenticated;

drop trigger if exists disable_pilot_bid_window_enforcement on public.bid_year_settings;
create trigger disable_pilot_bid_window_enforcement
before insert or update on public.bid_year_settings
for each row execute function private.disable_pilot_bid_window_enforcement();

update public.bid_year_settings
set enforce_bid_windows = false,
    updated_at = now()
where pilot_database;
