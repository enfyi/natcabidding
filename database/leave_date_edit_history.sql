-- Add saved date changes to the existing, area-scoped intake reader.
-- Reuse audit records so earlier edits are included without backfilling data.
create or replace function private.read_leave_intake_queue_with_weeks(queue_bid_year integer)
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(
    to_jsonb(queue) || jsonb_build_object(
      'weekBucketStarts', coalesce((
        select jsonb_agg(bucket.bucket_start_date order by bucket.bucket_start_date)
        from public.leave_request_week_buckets bucket
        where bucket.leave_request_id = queue.id
          and queue.round_number = 1 and queue.status in ('pending', 'approved')
      ), '[]'::jsonb),
      'leaveEditHistory', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', event.id, 'editedAt', event.created_at,
          'editedBy', coalesce(editor.initials, 'Former intake/admin'),
          'before', event.before_dates, 'after', event.after_dates
        ) order by event.created_at desc, event.id)
        from (
          select audit.id, audit.actor_id, audit.created_at,
            jsonb_build_object('start_date', audit.details->>'old_start_date', 'end_date', audit.details->>'old_end_date') as before_dates,
            jsonb_build_object('start_date', audit.details->>'new_start_date', 'end_date', audit.details->>'new_end_date') as after_dates
          from public.audit_events audit
          where audit.entity_table = 'leave_requests' and audit.entity_id = queue.id
            and audit.event_type in ('approved_leave_dates_replaced', 'bidder_leave_dates_edited')
            and (audit.details->>'old_start_date', audit.details->>'old_end_date')
              is distinct from (audit.details->>'new_start_date', audit.details->>'new_end_date')
          union all
          select audit.id, audit.actor_id, audit.created_at,
            jsonb_build_object('start_date', prior->>'requested_start_date', 'end_date', prior->>'requested_end_date'),
            jsonb_build_object('start_date', next->>'requested_start_date', 'end_date', next->>'requested_end_date')
          from public.audit_events audit
          cross join lateral jsonb_array_elements(audit.details->'before'->'leave') prior
          cross join lateral jsonb_array_elements(audit.details->'after'->'leave') next
          where audit.event_type = 'bidder_bids_edited' and audit.entity_table = 'bidders'
            and audit.entity_id = queue.bidder_id
            and audit.bid_year_id = (select request.bid_year_id from public.leave_requests request where request.id = queue.id)
            and prior->>'id' = queue.id::text and next->>'id' = queue.id::text
            and (prior->>'requested_start_date', prior->>'requested_end_date')
              is distinct from (next->>'requested_start_date', next->>'requested_end_date')
        ) event
        left join public.bidders editor on editor.id = event.actor_id
      ), '[]'::jsonb)
    ) order by queue.created_at desc, queue.id
  ), '[]'::jsonb)
  from public.read_leave_intake_queue(queue_bid_year) queue
  where (select auth.uid()) is not null;
$function$;
revoke all on function private.read_leave_intake_queue_with_weeks(integer) from public, anon;
grant execute on function private.read_leave_intake_queue_with_weeks(integer) to authenticated;
