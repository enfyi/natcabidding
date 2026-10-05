-- Run against a database with linked Area C intake and controller accounts.
begin;
do $test$
declare actor record; areas_seen integer; foreign_rows integer;
begin
 for actor in select b.auth_user_id, b.email, b.role, b.area_id from public.bidders b join public.areas a on a.id=b.area_id where b.active and b.auth_user_id is not null and a.name='Area C' and b.role in ('intake','controller') loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
 select count(distinct area_id), count(*) filter(where area_id<>actor.area_id) into areas_seen,foreign_rows from public.read_bidding_roster(false);
 if actor.role='intake' and (areas_seen<7 or foreign_rows=0) then raise exception 'Intake must see every area'; end if;
 if actor.role='controller' and foreign_rows<>0 then raise exception 'Controller scope widened'; end if;
 end loop;
end $test$;
rollback;
