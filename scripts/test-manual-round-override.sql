-- Uses existing linked profiles; rolls back session settings and all test work.
begin;
do $$
declare
  profile record;
  bounds record;
  rejected boolean;
  tested integer := 0;
  target record;
  closed_round integer;
  year_number integer;
begin
  for profile in
    select distinct on (role) role, auth_user_id, email
    from public.bidders where active and auth_user_id is not null
    order by role, id
  loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub',profile.auth_user_id,'email',profile.email)::text,true);
    perform private.assert_manual_bid_access(false);
    rejected := false;
    begin
      perform private.assert_manual_bid_access(true);
    exception when insufficient_privilege then rejected := true;
    end;
    if rejected is distinct from (profile.role not in ('admin','intake')) then
      raise exception 'Incorrect manual access for role %',profile.role;
    end if;
    if profile.role not in ('admin','intake') then
      rejected := false;
      begin
        perform public.submit_leave_bid_batch(2027,'[]'::jsonb,null,null,true);
      exception when insufficient_privilege then rejected := true;
      end;
      if not rejected then raise exception 'Leave RPC allowed unauthorized manual flag'; end if;
      rejected := false;
      begin
        perform public.submit_rdo_bid(2027,null,null,false,false,null,1,null,null,true);
      exception when insufficient_privilege then rejected := true;
      end;
      if not rejected then raise exception 'RDO RPC allowed unauthorized manual flag'; end if;
    else
      select b.initials,a.name area,y.bid_year,y.id year_id into target
      from public.bidders b join public.areas a on a.id=b.area_id
      cross join public.bid_years y join public.bid_year_settings s on s.bid_year_id=y.id
      where b.active and b.bid_role not in ('ADM','NB') and s.enforce_bid_windows
      order by y.bid_year desc,b.id limit 1;
      if target.year_id is not null then
        select w.round_number into closed_round
        from public.bid_windows w join public.bidders b on b.id=w.bidder_id
        where w.bid_year_id=target.year_id and b.active and b.bid_role not in ('ADM','NB')
        group by w.round_number
        having now()<min(w.opens_at) or now()>=max(w.closes_at)
        order by w.round_number limit 1;
        if closed_round is not null then
          rejected := false;
          begin
            perform public.submit_leave_bid_batch(target.bid_year,
              jsonb_build_array(jsonb_build_object('start_date',make_date(target.bid_year,1,11),
                'end_date',make_date(target.bid_year,1,11),'round',closed_round)),
              target.initials,target.area,true);
          exception when raise_exception then
            if sqlerrm like '%requested bidding round is not open%' then rejected:=true;
            else raise; end if;
          end;
          if not rejected then raise exception 'Manual leave allowed a closed/future round'; end if;
          rejected := false;
          begin
            perform public.submit_rdo_bid(target.bid_year,null,null,false,false,null,
              closed_round,target.initials,target.area,true);
          exception when raise_exception then
            if sqlerrm like '%requested bidding round is not open%' then rejected:=true;
            else raise; end if;
          end;
          if not rejected then raise exception 'Manual RDO allowed a closed/future round'; end if;
        end if;
      end if;
    end if;
    tested := tested + 1;
  end loop;
  if tested = 0 then raise exception 'No linked profiles available for verification'; end if;
  for bounds in
    select w.bid_year_id,w.round_number,min(w.opens_at) first_open,max(w.closes_at) last_close
    from public.bid_windows w join public.bidders b on b.id=w.bidder_id
    where b.active and b.bid_role not in ('ADM','NB') group by 1,2
  loop
    if public.is_area_bid_round_open(bounds.bid_year_id,null,bounds.round_number,bounds.first_open-interval '1 millisecond')
      or not public.is_area_bid_round_open(bounds.bid_year_id,null,bounds.round_number,bounds.first_open)
      or not public.is_area_bid_round_open(bounds.bid_year_id,null,bounds.round_number,bounds.last_close-interval '1 millisecond')
      or public.is_area_bid_round_open(bounds.bid_year_id,null,bounds.round_number,bounds.last_close) then
      raise exception 'Incorrect round boundary for round %',bounds.round_number;
    end if;
  end loop;
end;
$$;
rollback;
