-- Exercise the complete RDO save, including existing approved leave, and
-- roll back every bid, inventory, holiday, and audit change made by the test.
begin;
do $test$
declare
  actor public.bidders%rowtype;
  candidate record;
  snapshot jsonb;
  result jsonb;
  changes jsonb;
  tested integer := 0;
begin
  select b.* into strict actor from public.bidders b
  where active and auth_user_id is not null and role <> 'admin'
    and (role='intake' or exists (
      select 1 from public.intake_schedules s where s.intake_user_id=b.id
        and now() between s.starts_at-interval '60 minutes' and s.ends_at
    )) limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  for candidate in
    select b.id, y.id year_id, y.bid_year, l.id line_id, l.fatigue_group,
      l.flex, l.aws, l.mid
    from public.bidders b
    join public.rdo_lines l on l.assigned_bidder_id=b.id and l.status='taken'
    join public.bid_years y on y.id=l.bid_year_id
    where b.active and b.area_id <> actor.area_id and b.bid_role='CPC'
      and exists(select 1 from public.intake_submissions s where
        s.bidder_id=b.id and s.bid_year_id=y.id and s.submission_type='rdo' and s.status='approved')
      and exists(select 1 from public.leave_requests r where
        r.bidder_id=b.id and r.bid_year_id=y.id and r.status='approved')
    order by b.id limit 3
  loop
    snapshot := private.bidder_editor_snapshot(candidate.year_id,candidate.id);
    changes := jsonb_build_object(
      'rdo',jsonb_build_object('line_id',candidate.line_id,
        'fatigue_group',candidate.fatigue_group,'flex',candidate.flex,
        'aws',not candidate.aws,'mid',candidate.mid),
      'leave',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',r->>'id','start_date',r->>'requested_start_date',
        'end_date',r->>'requested_end_date')),'[]'::jsonb)
        from jsonb_array_elements(snapshot->'leave') r));
    result := public.edit_admin_bidder(candidate.bid_year,candidate.id,snapshot,changes,false);
    if result->>'valid' is distinct from 'true' or result->>'saved' is distinct from 'true' then
      raise exception 'Full RDO save with approved leave failed: %',result;
    end if;
    if (select aws from public.rdo_lines where id=candidate.line_id)
      is distinct from not candidate.aws then
      raise exception 'RDO edit did not persist within the test transaction';
    end if;
    tested := tested+1;
  end loop;
  if tested=0 then raise exception 'No cross-area approved RDO with approved leave test fixture found'; end if;
end;
$test$;
rollback;
