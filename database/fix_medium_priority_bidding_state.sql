begin;

create or replace function public.read_bidding_state(requested_bid_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      'line', rl.line_code, 'range', case
        when lr.id is null then null
        when lr.requested_end_date = lr.requested_start_date then to_char(lr.requested_start_date, 'Mon FMDD, YYYY')
        when extract(year from lr.requested_start_date) = extract(year from lr.requested_end_date) then
          to_char(lr.requested_start_date, 'Mon FMDD') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
        else to_char(lr.requested_start_date, 'Mon FMDD, YYYY') || ' - ' || to_char(lr.requested_end_date, 'Mon FMDD, YYYY')
      end,
      'days', lr.charged_days, 'priority', lr.priority, 'payload', s.payload
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
    and (actor.role in ('admin', 'intake') or s.area_id = actor.area_id)
    and (actor.role in ('admin', 'intake') or s.bidder_id = actor.id);

  return coalesce(result, jsonb_build_object('submissions', '[]'::jsonb));
end
$$;

revoke all on function public.read_bidding_state(integer) from public, anon;
grant execute on function public.read_bidding_state(integer) to authenticated;

commit;
