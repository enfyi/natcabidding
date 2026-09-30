-- Use only on an isolated pilot; fixture changes are rolled back.
begin;
do $test$
declare
 actor public.bidders%rowtype;
 y public.bid_years%rowtype;
 fixture uuid;
 req uuid;
 sid uuid;
 i integer;
 total integer;
begin
 select * into strict actor from public.bidders where active and role='admin' and auth_user_id is not null limit 1;
 select * into strict y from public.bid_years order by bid_year desc limit 1;
 if not exists(select 1 from public.bid_year_settings where bid_year_id=y.id and pilot_database) then raise exception 'Pilot required.'; end if;
 perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email)::text,true);
 insert into public.bidders(area_id,first_name,last_name,initials,email,leave_slot_allowance)
 values(actor.area_id,'Holiday','Fixture','TESTH','holiday-fixture@example.invalid',1000) returning id into fixture;
 for i in 0..1 loop
  insert into public.leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
  values(y.id,actor.area_id,make_date(y.bid_year,6,18)+i,'cpc','TESTH');
  insert into public.leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days,submitted_at)
  values(y.id,fixture,1,i+1,'pending',make_date(y.bid_year,6,18)+i,make_date(y.bid_year,6,18)+i,i,now()) returning id into req;
  insert into public.leave_request_dates(leave_request_id,leave_date,charged,is_rdo,is_holiday,is_holiday_in_lieu)
  values(req,make_date(y.bid_year,6,18)+i,i=1,false,i=1,i=0);
  select count(*) into total from public.leave_slots where source_leave_request_id=req and status='held' and slot_initials='TESTH';
  if total<>1 then raise exception 'Holiday/in-lieu bid did not reserve a visible slot.'; end if;
  insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,leave_request_id,submission_type,status,payload,submitted_at)
  values(y.id,actor.area_id,fixture,1,req,'leave','pending','{}',now()) returning id into sid;
  perform public.review_bidding_submission(sid,'approved');
  select count(*) into total from public.leave_slots where source_leave_request_id=req;
  if total<>1 then raise exception 'Approval claimed more than one slot.'; end if;
  select count(*) into total from public.leave_slots where source_leave_request_id=req and status='approved' and slot_initials='TESTH';
  if total<>1 then raise exception 'Approval did not preserve the visible initials.'; end if;
  update public.leave_requests set status='cancelled' where id=req;
  select count(*) into total from public.leave_slots where source_leave_request_id=req;
  if total<>0 then raise exception 'Cancellation did not release the holiday slot.'; end if;
 end loop;
end;
$test$;
rollback;
