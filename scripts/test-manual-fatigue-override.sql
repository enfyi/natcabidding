-- Full RPC regression using isolated fixtures. All fixtures and audit events roll back.
begin;
do $test$
declare
  actor public.bidders%rowtype;
  ordinary public.bidders%rowtype;
  year_id uuid;
  year_number integer;
  area_id uuid := gen_random_uuid();
  targets uuid[] := array[]::uuid[];
  lines uuid[] := array[]::uuid[];
  target_id uuid;
  line_id uuid;
  initials_prefix text := 'FT' || left(replace(gen_random_uuid()::text,'-',''),10);
  result jsonb;
  saved_id uuid;
  i integer;
  blocked boolean;
begin
  select * into strict actor from public.bidders
    where active and role='admin' and auth_user_id is not null limit 1;
  select * into strict ordinary from public.bidders
    where active and role='controller' and auth_user_id is not null limit 1;
  select id,bid_year into strict year_id,year_number from public.bid_years order by bid_year desc limit 1;
  insert into public.areas(id,code,name) values(area_id,'fatigue-test-'||area_id::text,'Area A');
  for i in 1..4 loop
    insert into public.bidders(area_id,first_name,last_name,initials,role,bid_role,active)
      values(area_id,'Fatigue','Regression',initials_prefix||i,'controller','CPC',true) returning id into target_id;
    targets := array_append(targets,target_id);
    insert into public.rdo_lines(bid_year_id,area_id,line_code,line_type,pattern,fatigue_group,status,assigned_bidder_id)
      values(year_id,area_id,'FT-'||i,'CPC','S/S',case when i<=2 then 'A' when i=3 then 'B' else null end,
        case when i<4 then 'taken' else 'open' end,case when i<4 then target_id else null end)
      returning id into line_id;
    lines := array_append(lines,line_id);
  end loop;
  if private.fatigue_group_is_available(year_id,area_id,lines[4],'A',targets[4]) then
    raise exception 'Fixture must have a full A group';
  end if;
  if not private.fatigue_group_is_available(year_id,area_id,lines[4],'C',targets[4]) then
    raise exception 'Balanced 2/1/1 must leave a C slot';
  end if;
  if has_table_privilege('authenticated','private.manual_rdo_fatigue_overrides','INSERT')
     or has_function_privilege('anon','public.submit_manual_rdo_fatigue_override(integer,text,text,boolean,boolean,text,integer,text,text,boolean)','EXECUTE') then
    raise exception 'Override authorization is exposed to unauthorized roles';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ordinary.auth_user_id,'email',ordinary.email,'role','authenticated')::text,true);
  blocked := false;
  begin
    perform public.submit_manual_rdo_fatigue_override(year_number,'FT-4','A',true,false,'No',1,initials_prefix||4,'Area A',true);
  exception when others then
    if sqlerrm not like 'Only intake and admin%' then raise; end if;
    blocked := true;
  end;
  if not blocked then raise exception 'Controller created an override'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  blocked := false;
  begin
    perform public.submit_rdo_bid(year_number,'FT-4','A',true,false,'No',1,initials_prefix||4,'Area A',true);
  exception when others then
    if sqlerrm not like 'Fatigue group % is full%' then raise; end if;
    blocked := true;
  end;
  if not blocked then raise exception 'Ordinary submission bypassed full capacity'; end if;

  result := public.submit_manual_rdo_fatigue_override(year_number,'FT-4','A',true,false,'No',1,initials_prefix||4,'Area A',true);
  saved_id := (result->>'submission_id')::uuid;
  if not private.rdo_fatigue_override_authorized(saved_id,lines[4],'A') then raise exception 'Admin override was not saved'; end if;
  if private.rdo_fatigue_override_authorized(saved_id,lines[3],'A')
     or private.rdo_fatigue_override_authorized(saved_id,lines[4],'B') then raise exception 'Override escaped its line/group scope'; end if;

  -- A different group must still pass capacity, even with an override flag.
  blocked := false;
  begin
    perform public.review_bidding_submission(saved_id,'approved',null,'{"fatigueGroup":"B","fatigueOverride":true}'::jsonb);
  exception when others then
    if sqlerrm not like 'Fatigue group % is full%' then raise; end if;
    blocked := true;
  end;
  if not blocked then raise exception 'Override approved the wrong group'; end if;

  -- Resubmission must remove stale authorization; forged JSON cannot restore it.
  perform public.submit_rdo_bid(year_number,'FT-4',null,true,false,'No',1,initials_prefix||4,'Area A',true);
  if private.rdo_fatigue_override_authorized(saved_id,lines[4],'A') then raise exception 'Stale override survived resubmission'; end if;
  update public.intake_submissions set payload=payload||'{"fatigueGroup":"A","fatigueOverride":true}'::jsonb where id=saved_id;
  blocked := false;
  begin
    perform public.review_bidding_submission(saved_id,'approved',null,'{}'::jsonb);
  exception when others then
    if sqlerrm not like 'Fatigue group % is full%' then raise; end if;
    blocked := true;
  end;
  if not blocked then raise exception 'Forged JSON authorized an override'; end if;

  -- The same protected RPC also permits an intake account.
  update public.bidders set role='intake' where id=actor.id;
  result := public.submit_manual_rdo_fatigue_override(year_number,'FT-4','A',true,false,'No',1,initials_prefix||4,'Area A',true);
  saved_id := (result->>'submission_id')::uuid;
  perform public.review_bidding_submission(saved_id,'approved',null,'{"fatigueOverride":true}'::jsonb);
  if not exists(select 1 from public.rdo_lines where id=lines[4] and status='taken' and fatigue_group='A') then
    raise exception 'Authorized full-group override was not approved';
  end if;
  if not exists(select 1 from public.audit_events where entity_id=saved_id and event_type='manual_fatigue_override') then
    raise exception 'Override audit was not recorded';
  end if;
end;
$test$;
select 'PASS full-group approval, admin/intake access, controller denial, forged flags, scope binding, stale cleanup, audit, and balanced remainder' result;
rollback;
