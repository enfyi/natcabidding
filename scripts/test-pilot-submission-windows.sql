-- Run against an isolated pilot after pilot_submission_window_fix.sql.
-- All fixture data, settings, and bids are rolled back.
begin;
do $test$
declare
  tester public.bidders%rowtype;
  line public.rdo_lines%rowtype;
  year_id uuid;
  result jsonb;
  rejected boolean;
begin
  select s.bid_year_id into strict year_id from public.bid_year_settings s
  join public.bid_years y on y.id=s.bid_year_id where y.bid_year=2027 and s.pilot_database;
  select b.* into strict tester from public.bidders b
  join public.bid_year_pilot_members m on m.bidder_id=b.id and m.bid_year_id=year_id
  where b.active and b.auth_user_id is not null and b.role='controller' and b.bid_role='CPC' limit 1;
  select * into strict line from public.rdo_lines l
  where l.bid_year_id=year_id and l.area_id=tester.area_id and l.line_type='CPC' and l.status='open' limit 1;
  -- Use an admin identity only for fixture cleanup, then run both public RPCs
  -- with a selected controller identity, outside any personal bid window.
  perform set_config('request.jwt.claims', (
    select jsonb_build_object('sub',b.auth_user_id,'email',b.email,'role','authenticated')::text
    from public.bidders b where b.role='admin' and b.active and b.auth_user_id is not null limit 1
  ),true);
  delete from public.leave_requests where bidder_id=tester.id and bid_year_id=year_id;
  delete from public.intake_submissions where bidder_id=tester.id and bid_year_id=year_id;
  delete from public.bid_windows where bidder_id=tester.id and bid_year_id=year_id;
  update public.bid_year_settings set pilot_enabled=true,pilot_open_rounds=array[1],enforce_bid_windows=true where bid_year_id=year_id;
  if (select enforce_bid_windows from public.bid_year_settings where bid_year_id=year_id) then
    raise exception 'Pilot settings still enforce scheduled windows';
  end if;
  insert into public.leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
  values(year_id,tester.area_id,'2027-06-16','cpc','PILOT-WINDOW-REGRESSION'),
        (year_id,tester.area_id,'2027-06-17','cpc','PILOT-WINDOW-REGRESSION') on conflict do nothing;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',tester.auth_user_id,'email',tester.email,'role','authenticated')::text,true);
  result := public.submit_rdo_bid(2027,line.line_code,'A',false,false,null,1);
  if not exists(select 1 from public.intake_submissions where bidder_id=tester.id and bid_year_id=year_id and round_number=1 and submission_type='rdo' and status='pending') then
    raise exception 'RDO RPC did not save an enabled-round submission';
  end if;
  result := public.submit_leave_bid_batch(2027,jsonb_build_array(jsonb_build_object('start_date','2027-06-16','end_date','2027-06-16','round',1,'rdo_line_code',line.line_code)));
  if not exists(select 1 from public.leave_requests where bidder_id=tester.id and bid_year_id=year_id and round_number=1 and status='pending') then
    raise exception 'Leave RPC did not save an enabled-round submission';
  end if;
  rejected := false;
  begin perform public.submit_rdo_bid(2027,line.line_code,'A',false,false,null,2);
  exception when others then
    if sqlerrm <> 'Pilot Round 2 is turned off by an administrator.' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Closed round accepted an RDO bid'; end if;
  rejected := false;
  begin perform public.submit_leave_bid_batch(2027,jsonb_build_array(jsonb_build_object('start_date','2027-06-17','end_date','2027-06-17','round',2,'rdo_line_code',line.line_code)));
  exception when others then
    if sqlerrm <> 'Pilot Round 2 is turned off by an administrator.' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Closed round accepted leave'; end if;
  rejected := false;
  begin perform private.submit_leave_bid_batch_unchecked(2027,jsonb_build_array(jsonb_build_object('start_date','2027-06-17','end_date','2027-06-17','round',2)));
  exception when others then
    if sqlerrm <> 'Pilot Round 2 is turned off by an administrator.' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Closed round bypassed the inner leave submitter'; end if;
  -- Production uses scheduled windows even if an open-round list exists.
  update public.bid_year_settings set pilot_database=false,enforce_bid_windows=true where bid_year_id=year_id;
  rejected := false;
  begin perform public.submit_rdo_bid(2027,line.line_code,'A',false,false,null,1);
  exception when others then
    if sqlerrm <> 'Your bidding window is not open.' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Production skipped its scheduled window'; end if;
end;
$test$;
select 'PASS real RDO and leave submission RPCs outside hours, closed-round rejection, production windows' as result;
rollback;
