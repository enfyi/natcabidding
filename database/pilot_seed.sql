-- Apply only to the isolated, disposable pilot database after pilot_mode.sql.
-- This explicit marker unlocks the admin pilot and reset controls.

insert into public.bid_year_settings (bid_year_id, pilot_database, pilot_enabled, pilot_name)
select byear.id, true, false, byear.bid_year || ' Bidding Pilot'
from public.bid_years byear
where byear.bid_year = 2027
on conflict (bid_year_id) do update
set pilot_database = true,
    pilot_enabled = false,
    pilot_name = excluded.pilot_name,
    pilot_last_reset_at = now(),
    updated_at = now();
