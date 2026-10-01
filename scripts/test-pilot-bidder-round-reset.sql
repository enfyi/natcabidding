-- Run only in the isolated pilot; everything, including resets, rolls back.
begin;
do $$
declare
  admin_row public.bidders%rowtype;
  target public.bidders%rowtype;
  year_id uuid;
  year_number integer;
  fixture_ids uuid[] := '{}'::uuid[];
  fixture_id uuid;
  slot_id uuid;
  override_id uuid;
  settings_before jsonb;
  others_before jsonb;
  others_after jsonb;
  round integer;
begin
  select b.* into strict admin_row from public.bidders b
  where b.role = 'admin' and b.active and b.auth_user_id is not null limit 1;
  select y.id, y.bid_year into strict year_id, year_number
  from public.bid_years y join public.bid_year_settings s on s.bid_year_id = y.id
  where s.pilot_database limit 1;
  select b.* into strict target from public.bidders b
  join public.bid_year_pilot_members m on m.bidder_id = b.id and m.bid_year_id = year_id
  where b.active and b.role <> 'admin' limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',admin_row.auth_user_id,'email',admin_row.email,'role','authenticated')::text,true);
  update public.bid_year_settings set pilot_enabled = true, pilot_open_rounds = array[1,2,3,4,5,6] where bid_year_id = year_id;
  select to_jsonb(s) into settings_before from public.bid_year_settings s where s.bid_year_id = year_id;
  select jsonb_build_object(
    'requests',(select jsonb_agg(to_jsonb(r) order by r.id) from public.leave_requests r where r.bid_year_id=year_id and r.bidder_id<>target.id),
    'submissions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.intake_submissions s where s.bid_year_id=year_id and s.bidder_id<>target.id),
    'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.rdo_lines l where l.bid_year_id=year_id and l.assigned_bidder_id<>target.id),
    'slots',(select jsonb_agg(to_jsonb(s) order by s.id) from public.leave_slots s where s.bid_year_id=year_id and s.bidder_id<>target.id)
  ) into others_before;
  -- The pilot currently accepts leave entries in rounds 1–4. Also exercise
  -- resets for the two reserved rounds below, without inserting invalid bids.
  for round in 1..4 loop
    insert into public.leave_requests(bid_year_id,bidder_id,round_number,priority,status)
    values(year_id,target.id,round,1000000,'draft') returning id into fixture_id;
    fixture_ids := array_append(fixture_ids,fixture_id);
    insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,leave_request_id,submission_type,status)
    values(year_id,target.area_id,target.id,round,fixture_id,'leave','draft');
    insert into public.leave_credit_events(bid_year_id,bidder_id,round_number,credit_date,source,source_leave_request_id)
    values(year_id,target.id,round,make_date(year_number,1,11),'manual_adjustment',fixture_id);
  end loop;
  select s.id into strict slot_id from public.leave_slots s
  where s.bid_year_id=year_id and s.area_id=target.area_id and s.status='open' and s.bidder_id is null limit 1;
  update public.leave_slots set bidder_id=target.id,slot_initials=target.initials,status='pending',source_leave_request_id=fixture_ids[2] where id=slot_id;
  insert into public.leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code,bidder_id,slot_initials,status,source_leave_request_id)
  select s.bid_year_id,s.area_id,s.slot_date,s.slot_group,'OVR-reset-fixture',target.id,target.initials,'approved',fixture_ids[3]
  from public.leave_slots s where s.id=slot_id returning id into override_id;
  for round in 2..6 loop
    perform public.reset_pilot_bidder_round(year_number,target.id,round);
    if exists(select 1 from public.leave_requests where bid_year_id=year_id and bidder_id=target.id and round_number=round)
      or exists(select 1 from public.intake_submissions where bid_year_id=year_id and bidder_id=target.id and round_number=round)
      or exists(select 1 from public.leave_credit_events where bid_year_id=year_id and bidder_id=target.id and round_number=round) then
      raise exception 'Round % reset left bids or credits',round;
    end if;
    if not exists(select 1 from public.leave_requests where id=fixture_ids[1]) then raise exception 'Later round reset cleared Round 1'; end if;
    if round=2 and (not exists(select 1 from public.leave_requests where id=fixture_ids[3])
      or not exists(select 1 from public.leave_requests where id=fixture_ids[4])) then
      raise exception 'Round 2 reset cleared a later round';
    end if;
  end loop;
  if exists(select 1 from public.leave_slots where id=override_id) then raise exception 'Reset retained override capacity'; end if;
  if not exists(select 1 from public.leave_slots where id=slot_id and status='open' and bidder_id is null and source_leave_request_id is null) then
    raise exception 'Reset did not release slot';
  end if;
  -- Add another later-round fixture to prove Round 1 cascades to it.
  insert into public.leave_requests(bid_year_id,bidder_id,round_number,priority,status)
  values(year_id,target.id,4,1000001,'draft');
  perform public.reset_pilot_bidder_round(year_number,target.id,1);
  if exists(select 1 from public.leave_requests where bid_year_id=year_id and bidder_id=target.id)
    or exists(select 1 from public.intake_submissions where bid_year_id=year_id and bidder_id=target.id)
    or exists(select 1 from public.leave_credit_events where bid_year_id=year_id and bidder_id=target.id)
    or exists(select 1 from public.holiday_in_lieu_days where bid_year_id=year_id and bidder_id=target.id)
    or exists(select 1 from public.rdo_lines where bid_year_id=year_id and assigned_bidder_id=target.id) then
    raise exception 'Round 1 reset did not clear all rounds and RDO';
  end if;
  if settings_before is distinct from (select to_jsonb(s) from public.bid_year_settings s where s.bid_year_id=year_id) then
    raise exception 'Reset changed pilot settings';
  end if;
  if not exists(select 1 from public.bid_year_pilot_members where bid_year_id=year_id and bidder_id=target.id) then
    raise exception 'Reset removed allowed bidder';
  end if;
  select jsonb_build_object(
    'requests',(select jsonb_agg(to_jsonb(r) order by r.id) from public.leave_requests r where r.bid_year_id=year_id and r.bidder_id<>target.id),
    'submissions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.intake_submissions s where s.bid_year_id=year_id and s.bidder_id<>target.id),
    'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.rdo_lines l where l.bid_year_id=year_id and l.assigned_bidder_id<>target.id),
    'slots',(select jsonb_agg(to_jsonb(s) order by s.id) from public.leave_slots s where s.bid_year_id=year_id and s.bidder_id<>target.id)
  ) into others_after;
  if others_before is distinct from others_after then raise exception 'Reset changed another bidder'; end if;
  begin
    perform public.reset_pilot_bidder_round(year_number,gen_random_uuid(),2);
    raise exception 'Non-member reset was accepted';
  exception when others then
    if sqlerrm <> 'Choose an active allowed pilot bidder.' then raise; end if;
  end;
  begin
    perform public.reset_pilot_bidder_round(year_number,target.id,7);
    raise exception 'Invalid round was accepted';
  exception when others then
    if sqlerrm <> 'Choose a bidding round from 1 through 6.' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',coalesce(target.auth_user_id,gen_random_uuid()),'email',target.email,'role','authenticated')::text,true);
  begin
    perform public.reset_pilot_bidder_round(year_number,target.id,1);
    raise exception 'Non-admin reset was accepted';
  exception when others then
    if sqlerrm <> 'System administrator access is required.' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_row.auth_user_id,'email',admin_row.email,'role','authenticated')::text,true);
  update public.bid_year_settings set pilot_database=false where bid_year_id=year_id;
  begin
    perform public.reset_pilot_bidder_round(year_number,target.id,1);
    raise exception 'Production reset was accepted';
  exception when others then
    if sqlerrm <> 'Reset refused: this is not an isolated pilot database.' then raise; end if;
  end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.reset_pilot_bidder_round(year_number,target.id,1);
    raise exception 'Unauthenticated reset was accepted';
  exception when others then
    if sqlerrm <> 'System administrator access is required.' then raise; end if;
  end;
end;
$$;
rollback;
select 'PASS individual round resets, Round 1 cascade, slot release, preserved bidders/access/settings, and authorization guards' as result;
