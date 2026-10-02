-- Run only against the isolated pilot. Fixture changes are rolled back.
begin;
do $test$
declare
 y public.bid_years%rowtype;
 fixture uuid;
 auth_id uuid := gen_random_uuid();
 area uuid;
 line uuid;
begin
 select * into strict y from public.bid_years order by bid_year desc limit 1;
 if not exists(select 1 from public.bid_year_settings where bid_year_id=y.id and pilot_database) then raise exception 'Isolated pilot required.'; end if;
 update public.bid_year_settings set pilot_enabled=true, pilot_open_rounds=array[1,2,3,4] where bid_year_id=y.id;
 select id into strict area from public.areas order by id limit 1;
 insert into public.bidders(auth_user_id,area_id,first_name,last_name,initials,email,role,bid_role)
 values(auth_id,area,'Window','Fixture','TESTW','window-fixture@example.invalid','admin','CPC') returning id into fixture;
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'email','window-fixture@example.invalid')::text,true);
 insert into public.rdo_lines(bid_year_id,area_id,line_code,pattern,status,assigned_bidder_id,fatigue_group)
 values(y.id,area,'WINDOWTEST','WINDOWTEST','taken',fixture,'A') returning id into line;
 insert into public.intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values(y.id,area,fixture,1,line,'rdo','approved','{"line":"WINDOWTEST","fatigueGroup":"A"}',now());
 insert into public.bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at)
 values(y.id,fixture,1,now()-interval '3 hours',now()+interval '1 hour');
 perform public.submit_rdo_bid(y.bid_year,'WINDOWTEST','A',false,false,'No',1,null,null,false);
 if not exists(select 1 from public.intake_submissions where bidder_id=fixture and status='pending') then raise exception 'Pilot change refused outside scheduled window.'; end if;
 delete from public.intake_submissions where bidder_id=fixture and status='pending';
 delete from public.bid_windows where bidder_id=fixture;
 perform public.submit_rdo_bid(y.bid_year,'WINDOWTEST','A',false,false,'No',1,null,null,false);
 if not exists(select 1 from public.intake_submissions where bidder_id=fixture and status='pending') then raise exception 'Pilot change refused without scheduled window.'; end if;
 delete from public.intake_submissions where bidder_id=fixture and status='pending';
 insert into public.bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at)
 values(y.id,fixture,1,now()-interval '30 minutes',now()+interval '90 minutes');
 update public.bid_windows set opens_at=now()-interval '30 minutes',closes_at=now()+interval '90 minutes' where bidder_id=fixture;
 begin
  perform public.submit_rdo_bid(y.bid_year,'WINDOWTEST','A',false,false,'No',2,null,null,false);
  raise exception 'Change accepted in Round 2.';
 exception when others then if sqlerrm not like '%own two-hour Round 1 bid window%' then raise; end if; end;
 perform public.submit_rdo_bid(y.bid_year,'WINDOWTEST','A',false,false,'No',1,null,null,false);
 if not exists(select 1 from public.intake_submissions where bidder_id=fixture and status='pending') then raise exception 'Change refused inside personal Round 1 window.'; end if;
end;
$test$;
rollback;
