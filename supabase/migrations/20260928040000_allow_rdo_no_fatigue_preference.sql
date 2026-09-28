-- Let a bidder defer their fatigue-group choice to intake. The pending RDO
-- payload keeps fatigueGroup null; review_bidding_submission still requires
-- intake to choose A, B, or C before approval assigns the line.
create or replace function public.submit_rdo_bid(
  requested_bid_year integer,
  requested_line_code text,
  requested_fatigue_group text,
  requested_flex boolean,
  requested_aws boolean,
  requested_mid text,
  requested_round integer default null,
  target_initials text default null,
  target_area_name text default null,
  manual_entry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  target public.bidders%rowtype;
  year_row public.bid_years%rowtype;
  line_row public.rdo_lines%rowtype;
  resolved_round integer;
  submission_id uuid;
  area_max integer;
  crew_max integer;
  area_used integer;
  crew_used integer;
  enforce_bid_windows boolean := true;
  configured_test_round integer;
  ghost_bid boolean;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
    and active
  for update;
  if actor.id is null then raise exception 'Authenticated bidder profile required.'; end if;

  select * into strict year_row from public.bid_years where bid_year = requested_bid_year;

  select coalesce(settings.enforce_bid_windows, true), settings.test_bid_round
  into enforce_bid_windows, configured_test_round
  from public.bid_year_settings settings
  where settings.bid_year_id = year_row.id;
  enforce_bid_windows := coalesce(enforce_bid_windows, true);

  if target_initials is null then
    target := actor;
  else
    if not manual_entry or actor.role not in ('admin', 'intake') then
      raise exception 'Manual entry requires bidding reviewer access.';
    end if;
    select b.* into strict target from public.bidders b
    left join public.areas a on a.id = b.area_id
    where upper(b.initials) = upper(target_initials) and b.active
      and (target_area_name is null or a.name = target_area_name)
    order by case when b.area_id = actor.area_id then 0 else 1 end, b.id
    limit 1
    for update of b;
  end if;

  if manual_entry then
    resolved_round := requested_round;
    if resolved_round not between 1 and 4 then raise exception 'Round must be between 1 and 4.'; end if;
  elsif not enforce_bid_windows then
    resolved_round := coalesce(configured_test_round, requested_round);
    if resolved_round not between 1 and 4 then raise exception 'Round must be between 1 and 4.'; end if;
    if configured_test_round is not null and requested_round is distinct from configured_test_round then
      raise exception 'Testing mode is currently set to Round %.', configured_test_round;
    end if;
  else
    select bw.round_number into resolved_round
    from public.bid_windows bw
    where bw.bid_year_id = year_row.id and bw.bidder_id = target.id
      and now() >= bw.opens_at and now() < bw.closes_at
    order by bw.round_number
    limit 1;
    if resolved_round is null then raise exception 'Your bidding window is not open.'; end if;
  end if;

  ghost_bid := public.is_ghost_bidder(year_row.id, target.id);

  select * into strict line_row
  from public.rdo_lines rl
  where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
    and rl.line_code = requested_line_code
  for update;

  if target.bid_role <> 'GL' and line_row.status <> 'open'
     and line_row.assigned_bidder_id is distinct from target.id then
    raise exception 'RDO line % is already assigned.', requested_line_code;
  end if;

  if line_row.line_type = 'CPC' and target.bid_role <> 'GL' then
    requested_fatigue_group := nullif(trim(requested_fatigue_group), '');
    if requested_fatigue_group is not null and requested_fatigue_group not in ('A', 'B', 'C') then
      raise exception 'Choose fatigue group A, B, or C.';
    end if;

    if requested_fatigue_group is not null then
      select greatest(1, floor(count(*)::numeric / 3)::integer) into area_max
      from public.rdo_lines rl
      where rl.bid_year_id = year_row.id and rl.area_id = target.area_id and rl.line_type = 'CPC';
      select greatest(1, floor(count(*)::numeric / 3)::integer) into crew_max
      from public.rdo_lines rl
      where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
        and rl.line_type = 'CPC' and rl.pattern = line_row.pattern;
      select count(*) into area_used from public.rdo_lines rl
      where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
        and rl.line_type = 'CPC' and rl.status = 'taken'
        and rl.fatigue_group = requested_fatigue_group
        and rl.assigned_bidder_id is distinct from target.id;
      select count(*) into crew_used from public.rdo_lines rl
      where rl.bid_year_id = year_row.id and rl.area_id = target.area_id
        and rl.line_type = 'CPC' and rl.pattern = line_row.pattern and rl.status = 'taken'
        and rl.fatigue_group = requested_fatigue_group
        and rl.assigned_bidder_id is distinct from target.id;
      if area_used >= area_max or crew_used >= crew_max then
        raise exception 'Fatigue group % is full for this area or crew.', requested_fatigue_group;
      end if;
    end if;
  end if;

  select s.id into submission_id
  from public.intake_submissions s
  where s.bid_year_id = year_row.id and s.bidder_id = target.id
    and s.round_number = resolved_round and s.submission_type = 'rdo' and s.status = 'pending'
  for update;

  if submission_id is null then
    insert into public.intake_submissions (
      bid_year_id, area_id, bidder_id, round_number, rdo_line_id,
      submission_type, status, payload, submitted_at, is_ghost_bid
    ) values (
      year_row.id, target.area_id, target.id, resolved_round, line_row.id,
      'rdo', 'pending', jsonb_build_object(
        'line', line_row.line_code, 'fatigueGroup', requested_fatigue_group,
        'flex', requested_flex, 'aws', requested_aws, 'mid', requested_mid,
        'bidAs', target.bid_role, 'ghostBid', ghost_bid,
        'lineLabel', case when ghost_bid then 'Ghost Line' else 'RDO Line' end
      ), now(), ghost_bid
    ) returning id into submission_id;
  else
    update public.intake_submissions
    set rdo_line_id = line_row.id,
        is_ghost_bid = ghost_bid,
        payload = jsonb_build_object(
          'line', line_row.line_code, 'fatigueGroup', requested_fatigue_group,
          'flex', requested_flex, 'aws', requested_aws, 'mid', requested_mid,
          'bidAs', target.bid_role, 'ghostBid', ghost_bid,
          'lineLabel', case when ghost_bid then 'Ghost Line' else 'RDO Line' end
        ), submitted_at = now(), updated_at = now()
    where id = submission_id;
  end if;

  perform public.refresh_bidder_holiday_in_lieu(year_row.id, target.id);

  insert into public.audit_events (bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details)
  values (year_row.id, target.area_id, actor.id, 'rdo_bid_submitted', 'intake_submissions', submission_id,
    jsonb_build_object('target_bidder_id', target.id, 'line_code', line_row.line_code, 'round', resolved_round));

  return jsonb_build_object(
    'submission_id', submission_id,
    'round', resolved_round,
    'is_ghost_bid', ghost_bid
  );
end
$$;

revoke all on function public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)
from public, anon;
grant execute on function public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)
to authenticated;
