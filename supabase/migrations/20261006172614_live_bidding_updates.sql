-- Add live notifications without changing table grants or row-level access.
-- Existing installations already publish intake/leave/help changes.
do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach table_name in array array[
    'areas', 'bidders', 'rdo_lines', 'rdo_line_days',
    'intake_submissions', 'leave_requests', 'leave_request_dates',
    'leave_request_week_buckets', 'leave_credit_events', 'leave_slots',
    'leave_slot_capacities', 'bid_windows', 'intake_schedules',
    'intake_calendar_marks', 'intake_shift_presets', 'bid_year_settings',
    'bid_rounds', 'bidder_bid_year_settings', 'bid_years', 'holidays',
    'faq_entries', 'mou_documents', 'bidding_site_settings',
    'help_threads', 'help_messages'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
