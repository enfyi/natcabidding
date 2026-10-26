-- Transactional production regression. All fixture/configuration edits roll back.
begin;
do $test$
declare
  target public.bidders%rowtype;
  actor public.bidders%rowtype;
  year_id uuid := (select id from public.bid_years where bid_year=2027);
  full_day date;
  request_id uuid;
  submission_id uuid;
  reviewer_role text;
  manual boolean;
  caught text;
  target_id uuid;
  override_flag boolean;
begin
  select b.id, s.slot_date into strict target_id, full_day
  from public.bidders b join public.areas a on a.id=b.area_id
  join public.leave_slots s on s.area_id=b.area_id and s.bid_year_id=year_id
  where a.code='tmu' and b.active and b.auth_user_id is not null and b.bid_role='TMC'
    and not public.is_ghost_bidder(year_id,b.id)
    and s.slot_group='cpc' and s.status='unavailable'
    and not exists (select 1 from public.leave_slots o where o.bid_year_id=year_id and o.area_id=b.area_id and o.slot_date=s.slot_date and o.slot_group='cpc' and o.status='open')
    and not exists (select 1 from public.leave_requests lr where lr.bidder_id=b.id and lr.bid_year_id=year_id and lr.status in ('pending','approved') and s.slot_date between lr.requested_start_date and lr.requested_end_date)
    and not exists (select 1 from public.rdo_line_days d where d.rdo_line_id=public.effective_rdo_line_id(year_id,b.id) and d.is_rdo and d.weekday=extract(dow from s.slot_date))
    and not exists (select 1 from public.holidays h where h.bid_year_id=year_id and h.holiday_date=s.slot_date)
    and not exists (select 1 from public.holiday_in_lieu_days h where h.bid_year_id=year_id and h.bidder_id=b.id and h.in_lieu_date=s.slot_date)
  order by s.slot_date,b.id limit 1;
  select * into strict target from public.bidders where id=target_id;
  select * into strict actor from public.bidders where active and role='admin' and auth_user_id is not null order by id limit 1;
  update public.bid_year_settings set enforce_bid_windows=false,test_bid_round=3 where bid_year_id=year_id;
  foreach manual in array array[false,true] loop
    foreach reviewer_role in array array['admin','intake'] loop
      if manual then update public.bidders set role=reviewer_role where id=actor.id; end if;
      perform set_config('request.jwt.claim.sub',case when manual then actor.auth_user_id else target.auth_user_id end::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',case when manual then actor.auth_user_id else target.auth_user_id end,'email',case when manual then actor.email else target.email end,'role','authenticated')::text,true);
      caught := null;
      begin
        perform public.submit_leave_bid_batch(2027,jsonb_build_array(jsonb_build_object('start_date',full_day,'end_date',full_day,'round',3)),case when manual then target.initials else null end,case when manual then 'TMU' else null end,manual);
      exception when others then caught := sqlerrm; end;
      if caught is null or position('No CPC leave slot is available' in caught)=0 then
        raise exception 'Submission capacity regression (manual %, role %): %',manual,reviewer_role,caught;
      end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  insert into public.leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days)
  values(year_id,target.id,3,999,'pending',full_day,full_day,1) returning id into request_id;
  insert into public.leave_request_dates(leave_request_id,leave_date,charged) values(request_id,full_day,true);
  insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,leave_request_id,submission_type,status,payload)
  values(year_id,target.area_id,target.id,3,request_id,'leave','pending','{}') returning id into submission_id;
  foreach reviewer_role in array array['admin','intake'] loop
    update public.bidders set role=reviewer_role where id=actor.id;
    foreach override_flag in array array[false,true] loop
      caught := null;
      begin
        perform public.review_bidding_submission(submission_id,'approved',null,jsonb_build_object('leaveCapacityOverride',override_flag));
      exception when others then caught := sqlerrm; end;
      if caught is null or position('TMU Round 3 capacity is closed' in caught)=0 then
        raise exception 'Approval regression (role %, override %): %',reviewer_role,override_flag,caught;
      end if;
    end loop;
  end loop;
  if (select status from public.leave_requests where id=request_id)<>'pending' then raise exception 'Rejected approval modified request'; end if;
end
$test$;
rollback;
