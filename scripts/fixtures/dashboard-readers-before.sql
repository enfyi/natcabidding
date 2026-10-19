CREATE OR REPLACE FUNCTION public.read_bidding_state(requested_bid_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.bidders%rowtype;
  year_id uuid;
  result jsonb;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email') and active;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;
  select id into strict year_id from public.bid_years where bid_year = requested_bid_year;

  select jsonb_build_object(
    'submissions', coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'type', case when s.submission_type = 'rdo' then 'RDO Line' else 'Leave' end,
      'status', initcap(s.status), 'round', s.round_number, 'area', a.name,
      'name', b.first_name || ' ' || b.last_name, 'initials', b.initials,
      'bidAs', b.bid_role, 'seniority', b.seniority_rank,
      'submittedAt', s.submitted_at, 'reviewedAt', s.reviewed_at,
      'reviewedBy', reviewer.initials, 'denialReason', s.denial_reason,
      'requestId', s.leave_request_id,
      'line', rl.line_code, 'range', case
        when lr.id is null then null
        when lr.requested_end_date = lr.requested_start_date then to_char(lr.requested_start_date, 'Mon FMDD, YYYY')
        when extract(year from lr.requested_start_date) = extract(year from lr.requested_end_date) then
          to_char(lr.requested_start_date, 'Mon FMDD') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
        else to_char(lr.requested_start_date, 'Mon FMDD, YYYY') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
      end,
      'days', lr.charged_days, 'priority', lr.priority, 'is_ghost_bid', s.is_ghost_bid, 'payload', s.payload, 'bidderId', s.bidder_id, 'isChange', s.is_change, 'originalBid', s.original_bid, 'supersedesSubmissionId', s.supersedes_submission_id, 'changeSource', s.change_source
    ) order by s.submitted_at desc), '[]'::jsonb)
  ) into result
  from public.intake_submissions s
  left join public.bidders b on b.id = s.bidder_id
  left join public.areas a on a.id = s.area_id
  left join public.bidders reviewer on reviewer.id = s.reviewed_by
  left join public.rdo_lines rl on rl.id = s.rdo_line_id
  left join public.leave_requests lr on lr.id = s.leave_request_id
  where s.bid_year_id = year_id
    and s.submission_type in ('rdo', 'leave')
    and (private.can_review_intake_year(year_id) or s.area_id = actor.area_id)
    and (private.can_review_intake_year(year_id) or s.bidder_id = actor.id);

  return coalesce(result, jsonb_build_object('submissions', '[]'::jsonb));
end
$function$;

CREATE OR REPLACE FUNCTION public.read_leave_intake_queue(queue_bid_year integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, bidder_id uuid, round_number integer, priority integer, leave_type text, status text, requested_start_date date, requested_end_date date, charged_days integer, notes text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, denial_reason text, created_at timestamp with time zone, first_name text, last_name text, initials text, bid_role text, seniority_rank integer, area_id uuid, area_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranked_bidders as (
    select
      area_bidders.id,
      row_number() over (
        partition by area_bidders.area_id
        order by area_bidders.seniority_rank nulls last, area_bidders.last_name, area_bidders.first_name, area_bidders.id
      )::integer as area_seniority_rank
    from bidders area_bidders
    where area_bidders.active
  )
  select
    lr.id,
    lr.bidder_id,
    lr.round_number,
    lr.priority,
    lr.leave_type,
    lr.status,
    lr.requested_start_date,
    lr.requested_end_date,
    lr.charged_days,
    lr.notes,
    lr.submitted_at,
    lr.reviewed_at,
    lr.denial_reason,
    lr.created_at,
    b.first_name,
    b.last_name,
    b.initials,
    b.bid_role,
    rb.area_seniority_rank as seniority_rank,
    b.area_id,
    a.name as area_name
  from leave_requests lr
  join bid_years byear on byear.id = lr.bid_year_id
  join bidders b on b.id = lr.bidder_id and b.active
  join ranked_bidders rb on rb.id = b.id
  join areas a on a.id = b.area_id
  where (queue_bid_year is null or byear.bid_year = queue_bid_year)
    and (
      private.can_review_intake_year(lr.bid_year_id)
      or b.area_id = public.current_bidder_area_id()
    )
  order by lr.created_at desc
$function$;
