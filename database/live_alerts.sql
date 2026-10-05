-- Live alert invalidation uses existing SELECT grants and RLS policies.
-- No additional data access is granted by enabling replication.
do $$
declare
  alert_table text;
begin
  foreach alert_table in array array['intake_submissions', 'leave_requests', 'help_threads', 'help_messages'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = alert_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', alert_table);
    end if;
  end loop;
end;
$$;
