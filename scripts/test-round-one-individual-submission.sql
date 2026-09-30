-- Run against an isolated pilot. All fixture writes are rolled back.
begin;
do $test$
declare
  actor public.bidders%rowtype;
  year_row public.bid_years%rowtype;
  fixture_id uuid;
  items jsonb;
  result jsonb;
begin
  select * into strict actor from public.bidders
  where active and role = 'admin' and auth_user_id is not null limit 1;
  select * into strict year_row from public.bid_years order by bid_year desc limit 1;
  if not exists (select 1 from public.bid_year_settings where bid_year_id = year_row.id and pilot_database) then
    raise exception 'This regression test requires an isolated pilot.';
  end if;
  perform set_config('request.jwt.claim.sub', actor.auth_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',actor.auth_user_id,'email',actor.email)::text, true);
  insert into public.bidders(area_id,first_name,last_name,initials,email,role,bid_role,leave_slot_allowance)
  values(actor.area_id,'Regression','Fixture','TESTW','round-one-test@example.invalid','controller','CPC',1000)
  returning id into fixture_id;
  insert into public.rdo_lines(bid_year_id,area_id,line_code,pattern,status,assigned_bidder_id)
  values(year_row.id,actor.area_id,'TESTW','Regression fixture','taken',fixture_id);
  insert into public.leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
  select year_row.id,actor.area_id,make_date(year_row.bid_year,6,7) + offset_day,'cpc','TESTW'
  from generate_series(0,14) offset_day;
  select jsonb_agg(jsonb_build_object('start_date',day,'end_date',day,'round',1)) into items
  from (select make_date(year_row.bid_year,6,7) + offset_day as day
        from unnest(array[0,1,2,3,4,7,8,9,10,11]) offset_day) dates;
  result := public.submit_leave_bid_batch(year_row.bid_year,items,'TESTW',null,true);
  if jsonb_array_length(result -> 'submission_ids') <> 10 then
    raise exception 'Expected ten individual requests to pass as two weeks.';
  end if;
  begin
    perform public.submit_leave_bid_batch(year_row.bid_year,
      jsonb_build_array(jsonb_build_object('start_date',make_date(year_row.bid_year,6,21),'end_date',make_date(year_row.bid_year,6,21),'round',1)),
      'TESTW',null,true);
    raise exception 'Third week was incorrectly accepted.';
  exception when others then
    if sqlerrm not like '%Round 1 can include no more than 2 bid weeks%' then raise; end if;
  end;
end;
$test$;
rollback;
