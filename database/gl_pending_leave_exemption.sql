-- GL bids check inventory but never reserve it against other bidders.
do $upgrade$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname = 'submit_leave_bid_batch')
       or (n.nspname = 'private' and p.proname = 'replace_bidder_editor_leave_dates')
  loop
    definition := pg_catalog.pg_get_functiondef(routine.oid);
    definition := replace(definition,
      'b.bid_role not in (''ADM'', ''NB'')',
      'b.bid_role not in (''GL'', ''ADM'', ''NB'')');
    definition := replace(definition,
      'pending_bidder.bid_role not in (''ADM'', ''NB'')',
      'pending_bidder.bid_role not in (''GL'', ''ADM'', ''NB'')');
    execute definition;
  end loop;
end;
$upgrade$;
