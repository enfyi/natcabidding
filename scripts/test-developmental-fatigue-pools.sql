-- Production regression: verify KH -> B and AT -> C through the admin RPC.
-- All assignments, payload updates, and audit entries roll back.
begin;
do $test$
declare
  actor public.bidders%rowtype;
  candidate record;
  snapshot jsonb;
  draft jsonb;
  result jsonb;
  checked integer := 0;
begin
  select * into strict actor from public.bidders
    where role='admin' and active and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  for candidate in
    select b.id bidder_id,l.id line_id,l.bid_year_id,y.bid_year,
      case b.initials when 'KH' then 'B' else 'C' end requested_group
    from public.bidders b join public.areas a on a.id=b.area_id
    join public.rdo_lines l on l.assigned_bidder_id=b.id
    join public.bidding_site_settings s on s.active_bid_year_id=l.bid_year_id
    join public.bid_years y on y.id=l.bid_year_id
    where a.name='Area F' and b.active
      and ((b.initials='KH' and b.bid_role='R-DEV')
        or (b.initials='AT' and b.bid_role='D-DEV'))
  loop
    snapshot := private.bidder_editor_snapshot(candidate.bid_year_id,candidate.bidder_id);
    draft := jsonb_build_object('rdo',jsonb_build_object(
      'line_id',candidate.line_id,'fatigue_group',candidate.requested_group,
      'flex',coalesce((snapshot->'assignment'->>'flex')::boolean,false),
      'aws',coalesce((snapshot->'assignment'->>'aws')::boolean,false),
      'mid',coalesce(snapshot->'assignment'->>'mid','No')),
      'leave',coalesce((select jsonb_agg(jsonb_build_object(
        'id',v->>'id','start_date',v->>'requested_start_date','end_date',v->>'requested_end_date'))
        from jsonb_array_elements(snapshot->'leave') v),'[]'::jsonb));
    result := public.edit_admin_bidder(candidate.bid_year,candidate.bidder_id,snapshot,draft,false);
    if not coalesce((result->>'saved')::boolean,false) then
      raise exception 'Separate developmental pool admin save failed: %',result;
    end if;
    if result->'snapshot'->'assignment'->>'fatigue_group' is distinct from candidate.requested_group then
      raise exception 'Requested developmental group was not saved';
    end if;
    checked := checked + 1;
  end loop;
  if checked <> 2 then raise exception 'Expected both developmental regression bidders'; end if;
end $test$;
select 'PASS: KH -> B and AT -> C save through admin RPC; test changes rolled back' result;
rollback;
