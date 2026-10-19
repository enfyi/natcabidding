-- Run as the database owner. Uses existing profiles and rolls back all changes.
begin;
do $test$
declare
  actor public.bidders%rowtype;
  target_id uuid;
  inactive_id uuid;
  outsider public.bidders%rowtype;
  year_number integer;
  result jsonb;
begin
  select b.* into strict actor from public.bidders b
  where active and auth_user_id is not null and role <> 'admin'
    and (role='intake' or exists (
      select 1 from public.intake_schedules s where s.intake_user_id=b.id
        and now() between s.starts_at-interval '60 minutes' and s.ends_at
    )) limit 1;
  select id into strict target_id from public.bidders
    where active and area_id <> actor.area_id and bid_role not in ('ADM','NB') limit 1;
  select bid_year into strict year_number from public.bid_years order by bid_year desc limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  if private.bidder_editor_actor(target_id) <> actor.id then
    raise exception 'Cross-area intake access failed';
  end if;
  result := public.read_admin_bidder_editor(year_number,target_id);
  if result->'person'->>'id' <> target_id::text then
    raise exception 'Cross-area bidder load failed';
  end if;
  result := public.read_admin_bidder_editor(year_number,null,'');
  if not exists (select 1 from jsonb_array_elements(result->'bidders') b
    join public.bidders target on target.id=(b->>'id')::uuid
    where target.area_id <> actor.area_id) then
    raise exception 'Cross-area bidder search failed';
  end if;
  -- The save routine calls the same actor helper before doing any writes.
  update public.bidders set active=false where id=target_id;
  begin
    perform private.bidder_editor_actor(target_id);
    raise exception 'Inactive bidder was allowed';
  exception when others then
    if sqlerrm <> 'This bidder is outside your authorized area or is inactive.' then raise; end if;
  end;
  select b.* into strict outsider from public.bidders b
    where active and auth_user_id is not null and role not in ('admin','intake')
      and not exists (select 1 from public.intake_schedules s where s.intake_user_id=b.id
        and now() between s.starts_at-interval '60 minutes' and s.ends_at) limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',outsider.auth_user_id,'email',outsider.email,'role','authenticated')::text,true);
  begin
    perform private.bidder_editor_actor(null);
    raise exception 'Unscheduled bidder was allowed';
  exception when others then
    if sqlerrm <> 'Active intake or administrator access is required.' then raise; end if;
  end;
end;
$test$;
rollback;
