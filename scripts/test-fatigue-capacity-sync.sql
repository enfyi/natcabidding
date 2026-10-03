-- Pilot regression fixture: Area A F/S has four lines with A=1, B=1, C=0.
-- Run after fatigue_group_balancing.sql and fatigue_capacity_sync.sql.
-- Every submission, assignment, and audit event created here rolls back.
begin;
do $test$
declare
  actor public.bidders%rowtype;
  target public.bidders%rowtype;
  candidate public.rdo_lines%rowtype;
  year_number integer;
  result jsonb;
begin
  select l.* into strict candidate from public.rdo_lines l
    join public.areas a on a.id=l.area_id
    join public.bidding_site_settings s on s.active_bid_year_id=l.bid_year_id
    where a.name='Area A' and l.pattern='F/S' and l.status='open'
    order by l.line_code limit 1;
  select bid_year into strict year_number from public.bid_years where id=candidate.bid_year_id;
  select * into strict actor from public.bidders
    where role='admin' and active and auth_user_id is not null limit 1;
  select b.* into strict target from public.bidders b
    where b.area_id=candidate.area_id and b.bid_role='CPC' and b.active
      and not public.is_ghost_bidder(candidate.bid_year_id,b.id)
      and not exists(select 1 from public.rdo_lines l where l.bid_year_id=candidate.bid_year_id
        and l.assigned_bidder_id=b.id) limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',actor.auth_user_id,
    'email',actor.email,'role','authenticated')::text,true);
  if not private.fatigue_group_is_available(candidate.bid_year_id,candidate.area_id,candidate.id,'A',target.id) then
    raise exception 'Second slot in a four-line crew must be available';
  end if;
  -- No preference must continue to reach intake without a group assignment.
  result := public.submit_rdo_bid(year_number,candidate.line_code,null,true,false,'No',1,target.initials,'Area A',true);
  if (select payload->>'fatigueGroup' from public.intake_submissions where id=(result->>'submission_id')::uuid) is not null then
    raise exception 'No preference was not preserved';
  end if;
  result := public.submit_rdo_bid(year_number,candidate.line_code,'A',true,false,'No',1,target.initials,'Area A',true);
  perform public.review_bidding_submission((result->>'submission_id')::uuid,'approved',null,'{}'::jsonb);
  if not exists(select 1 from public.rdo_lines where id=candidate.id and status='taken' and fatigue_group='A') then
    raise exception 'The second A slot was not approved';
  end if;
  if private.fatigue_group_is_available(candidate.bid_year_id,candidate.area_id,candidate.id,'A',null)
    or private.fatigue_group_is_available(candidate.bid_year_id,candidate.area_id,candidate.id,'B',null) then
    raise exception 'A claimed remainder must block a third A or second B';
  end if;
  if not private.fatigue_group_is_available(candidate.bid_year_id,candidate.area_id,candidate.id,'C',null) then
    raise exception 'The remaining base C slot must stay available';
  end if;
  if not private.fatigue_group_is_available(candidate.bid_year_id,candidate.area_id,candidate.id,'A',target.id) then
    raise exception 'Existing bidder assignment must be excluded during changes';
  end if;
end;
$test$;
select 'PASS: second crew slot submits and approves; full groups block; no preference and bidder exclusion work' result;
rollback;
