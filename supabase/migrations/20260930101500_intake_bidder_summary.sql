-- Give authorized intake/admin users one protected read for a selected bidder's
-- contact information, annual allowance, RDO assignment, and exact leave dates.
create or replace function private.bidder_editor_snapshot(year_id uuid, target_id uuid)
returns jsonb language sql stable set search_path = '' as $$
select jsonb_build_object(
  'bidder_id', target_id,
  'bidder_version', (select b.updated_at from public.bidders b where b.id=target_id),
  'is_ghost_bidder', public.is_ghost_bidder(year_id, target_id),
  'assignment', (select to_jsonb(x) from (
    select line.id, line.line_code, line.fatigue_group, line.flex, line.aws, line.mid,
      line.four_ten, line.updated_at,
      (select coalesce(jsonb_agg(day.shift_code order by day.weekday),'[]'::jsonb)
       from public.rdo_line_days day where day.rdo_line_id=line.id) week
    from public.rdo_lines line
    where line.bid_year_id=year_id and line.assigned_bidder_id=target_id
      and line.status='taken'
    order by line.updated_at desc,line.id
    limit 1
  ) x),
  'rdo', (select to_jsonb(x) from (
    select id, rdo_line_id, round_number, status, payload, is_ghost_bid, updated_at
    from public.intake_submissions where bid_year_id=year_id and bidder_id=target_id
      and submission_type='rdo' and status in ('pending','approved')
    order by submitted_at desc nulls last,created_at desc,id limit 1
  ) x),
  'leave', coalesce((select jsonb_agg(to_jsonb(x) order by round_number,priority,id) from (
    select request.id, request.round_number, request.priority, request.status,
      request.requested_start_date, request.requested_end_date, request.charged_days,
      request.is_ghost_bid, request.updated_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'leave_date', day.leave_date,
        'charged', day.charged,
        'is_rdo', day.is_rdo,
        'is_holiday', day.is_holiday,
        'is_holiday_in_lieu', day.is_holiday_in_lieu
      ) order by day.leave_date),'[]'::jsonb)
       from public.leave_request_dates day where day.leave_request_id=request.id) dates
    from public.leave_requests request
    where request.bid_year_id=year_id and request.bidder_id=target_id
  ) x),'[]'::jsonb)
) $$;

revoke all on function private.bidder_editor_snapshot(uuid,uuid) from public, anon, authenticated;

create or replace function public.read_admin_bidder_editor(
  requested_bid_year integer,
  target_bidder_id uuid default null,
  search_text text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; year_id uuid; result jsonb;
begin
  actor_id := private.bidder_editor_actor(target_bidder_id);
  select id into strict year_id from public.bid_years where bid_year=requested_bid_year;
  if target_bidder_id is null then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into result from (
      select b.id,b.first_name,b.last_name,b.initials,a.name area,b.bid_role,
        public.is_ghost_bidder(year_id,b.id) is_ghost_bidder
      from public.bidders b join public.areas a on a.id=b.area_id
      join public.bidders actor on actor.id=actor_id
      where b.active and b.bid_role <> 'ADM' and (actor.role='admin' or b.area_id=actor.area_id)
        and (b.first_name || ' ' || b.last_name || ' ' || coalesce(b.initials,'')) ilike '%' || trim(coalesce(search_text,'')) || '%'
      order by b.last_name,b.first_name,b.id limit 50
    ) x;
    return jsonb_build_object('bidders',result);
  end if;
  return jsonb_build_object(
    'person',(select jsonb_build_object(
      'id',b.id,
      'first_name',b.first_name,
      'last_name',b.last_name,
      'initials',b.initials,
      'email',b.email,
      'phone',b.phone,
      'bid_role',b.bid_role,
      'seniority_rank',b.seniority_rank,
      'leave_slot_allowance',b.leave_slot_allowance,
      'area',a.name
    ) from public.bidders b left join public.areas a on a.id=b.area_id where b.id=target_bidder_id),
    'snapshot',private.bidder_editor_snapshot(year_id,target_bidder_id),
    'lines',(select coalesce(jsonb_agg(to_jsonb(x) order by line_code),'[]'::jsonb) from (
      select l.id,l.line_code,l.pattern,l.fatigue_group,l.mid,l.four_ten,l.status,l.assigned_bidder_id
      from public.rdo_lines l join public.bidders b on b.id=target_bidder_id join public.areas a on a.id=b.area_id
      where l.bid_year_id=year_id and l.area_id=b.area_id
        and public.rdo_line_matches_bid_role(b.bid_role,a.name,l.line_type,l.pattern)
    ) x));
end $$;

revoke all on function public.read_admin_bidder_editor(integer,uuid,text) from public,anon;
grant execute on function public.read_admin_bidder_editor(integer,uuid,text) to authenticated;
