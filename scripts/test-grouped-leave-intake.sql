begin;
-- All fixture changes must run in a transaction and be rolled back.
do $test$
declare
  actor public.bidders%rowtype;
  y public.bid_years%rowtype;
  fixture uuid;
  req uuid;
  submission uuid;
  first_week uuid[] := array[]::uuid[];
  second_week uuid[] := array[]::uuid[];
  later_batch uuid[] := array[]::uuid[];
  off integer;
  total integer;
  claims text;
begin
  select * into strict actor from public.bidders where active and role = 'admin' and auth_user_id is not null limit 1;
  select * into strict y from public.bid_years order by bid_year desc limit 1;
  if not exists (select 1 from public.bid_year_settings where bid_year_id=y.id and pilot_database) then
    raise exception 'Regression test requires the isolated pilot.';
  end if;
  update public.bid_year_settings set pilot_open_rounds=array[1,2,3,4] where bid_year_id=y.id;
  claims := jsonb_build_object('sub',actor.auth_user_id,'email',actor.email)::text;
  perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
  perform set_config('request.jwt.claims',claims,true);
  insert into public.bidders(area_id,first_name,last_name,initials,email,leave_slot_allowance)
  values(actor.area_id,'Group','Fixture','TESTG','group-test@example.invalid',1000) returning id into fixture;
  foreach off in array array[0,1,2,3,4,7,8,9,10,11] loop
    insert into public.leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days,submitted_at)
    values(y.id,fixture,1,off+1,'pending',make_date(y.bid_year,6,7)+off,make_date(y.bid_year,6,7)+off,1,now()) returning id into req;
    insert into public.leave_request_dates(leave_request_id,leave_date,charged)
    values(req,make_date(y.bid_year,6,7)+off,true);
    insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,leave_request_id,submission_type,status,payload,submitted_at)
    values(y.id,actor.area_id,fixture,1,req,'leave','pending','{}',now()) returning id into submission;
    if off < 7 then first_week:=array_append(first_week,submission); else second_week:=array_append(second_week,submission); end if;
    insert into public.leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
    values(y.id,actor.area_id,make_date(y.bid_year,6,7)+off,'cpc','TESTG');
  end loop;
  begin
    perform public.review_leave_submission_group(first_week || second_week,'approved');
    raise exception 'Two weeks incorrectly approved as one week.';
  exception when others then if sqlerrm not like '%one seven-day bid week%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.review_leave_submission_group(first_week,'approved');
    raise exception 'Unauthenticated group review was accepted.';
  exception when others then if sqlerrm not like '%reviewer access%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
  perform set_config('request.jwt.claims',claims,true);
  perform public.review_leave_submission_group(first_week,'approved');
  select count(*) into total from public.intake_submissions where id=any(first_week) and status='approved';
  if total<>5 then raise exception 'Expected five date approvals from one week action.'; end if;
  select count(*) into total from public.leave_slots where bidder_id=fixture;
  if total<>5 then raise exception 'Approval added skipped dates or missed selected dates.'; end if;
  -- Fail on the last chronological date after prior members may have succeeded.
  update public.leave_slots set status='unavailable'
  where bid_year_id=y.id and area_id=actor.area_id and slot_date=make_date(y.bid_year,6,18) and slot_group='cpc' and status='open';
  begin
    perform public.review_leave_submission_group(second_week,'approved');
    raise exception 'Expected capacity failure.';
  exception when others then if sqlerrm not like '%capacity is full%' then raise; end if; end;
  select count(*) into total from public.intake_submissions where id=any(second_week) and status='pending';
  if total<>5 then raise exception 'Failed group approval left a partial decision.'; end if;
  select count(*) into total from public.leave_slots where bidder_id=fixture;
  if total<>5 then raise exception 'Failed group approval left partial slot assignments.'; end if;
  perform public.review_leave_submission_group(second_week,'denied','Choose alternate dates.');
  select count(*) into total from public.intake_submissions where id=any(second_week) and status='denied' and denial_reason='Choose alternate dates.';
  if total<>5 then raise exception 'Week denial did not apply to each member.'; end if;
  foreach off in array array[0,9,20] loop
    insert into public.leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days,submitted_at)
    values(y.id,fixture,2,off+1,'pending',make_date(y.bid_year,7,1)+off,make_date(y.bid_year,7,1)+off,1,now()) returning id into req;
    insert into public.leave_request_dates(leave_request_id,leave_date,charged) values(req,make_date(y.bid_year,7,1)+off,true);
    insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,leave_request_id,submission_type,status,payload,submitted_at)
    values(y.id,actor.area_id,fixture,2,req,'leave','pending','{}',now()) returning id into submission;
    later_batch:=array_append(later_batch,submission);
    insert into public.leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code) values(y.id,actor.area_id,make_date(y.bid_year,7,1)+off,'cpc','TESTG');
  end loop;
  perform public.review_leave_submission_group(later_batch[1:1],'approved');
  select count(*) into total from public.intake_submissions where id=any(later_batch[2:3]) and status='pending';
  if total<>2 then raise exception 'Individual date decision changed the rest of the batch.'; end if;
  perform public.review_leave_submission_group(later_batch[2:3],'approved');
  select count(*) into total from public.intake_submissions where id=any(later_batch) and status='approved';
  if total<>3 then raise exception 'Later-round nonconsecutive batch did not approve.'; end if;
end;
$test$;

rollback;
