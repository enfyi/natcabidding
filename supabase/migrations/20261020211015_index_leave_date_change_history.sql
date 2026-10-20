-- The queue looks up audit history per request. Keep these lookups selective
-- without indexing unrelated audit events or including full snapshot payloads.
create index if not exists audit_leave_date_edits_lookup_idx
  on public.audit_events (entity_id, created_at desc, id)
  where entity_table = 'leave_requests'
    and event_type in ('approved_leave_dates_replaced', 'bidder_leave_dates_edited');
create index if not exists audit_bidder_date_edits_lookup_idx
  on public.audit_events (entity_id, bid_year_id, created_at desc, id)
  where entity_table = 'bidders' and event_type = 'bidder_bids_edited';
