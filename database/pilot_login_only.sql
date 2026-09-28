-- Apply after all feature SQL in the isolated pilot project.
-- The pilot requires a real Supabase Auth session for every data read or write.
-- Supabase Auth endpoints remain reachable so users can sign in, but unrostered
-- accounts cannot claim a bidder profile and therefore cannot pass any RLS rule.

do $$
declare
  table_record record;
begin
  for table_record in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table %I.%I enable row level security', table_record.schemaname, table_record.tablename);
    execute format('revoke all on table %I.%I from anon', table_record.schemaname, table_record.tablename);
  end loop;
end
$$;

drop policy if exists "public can read bid years" on public.bid_years;
drop policy if exists "public can read bid rounds" on public.bid_rounds;
drop policy if exists "public can read holidays" on public.holidays;
drop policy if exists "public can read areas" on public.areas;
drop policy if exists "public can read rdo lines" on public.rdo_lines;
drop policy if exists "public can read rdo line days" on public.rdo_line_days;
drop policy if exists "public can read leave slots" on public.leave_slots;
drop policy if exists "public can read leave slot capacities" on public.leave_slot_capacities;
drop policy if exists "public can read bid year settings" on public.bid_year_settings;

revoke all on public.leave_request_totals from anon, authenticated;
revoke all on public.bidder_leave_summary from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_current_intake_or_admin() to authenticated;
grant execute on function public.live_help_session_is_valid(text) to authenticated;

alter function public.live_help_session_is_valid(text) set search_path = '';

grant select on table
  public.bid_years,
  public.areas,
  public.bidders,
  public.rdo_lines,
  public.rdo_line_days,
  public.bid_rounds,
  public.bid_windows,
  public.holidays,
  public.holiday_in_lieu_days,
  public.leave_slot_capacities,
  public.leave_slots,
  public.leave_requests,
  public.leave_request_week_buckets,
  public.leave_request_dates,
  public.leave_credit_events,
  public.intake_submissions,
  public.intake_schedules,
  public.help_threads,
  public.help_messages,
  public.audit_events,
  public.bid_year_settings
to authenticated;

grant insert, update on public.help_threads to authenticated;
grant insert on public.help_messages to authenticated;

-- Bids and decisions must go through the transactional RPCs above.
revoke insert, update, delete on
  public.bid_windows,
  public.rdo_lines,
  public.rdo_line_days,
  public.holiday_in_lieu_days,
  public.leave_slots,
  public.leave_requests,
  public.leave_request_dates,
  public.leave_request_week_buckets,
  public.leave_credit_events,
  public.intake_submissions,
  public.audit_events
from anon, authenticated;
