begin;
do $test$
declare actor public.bidders%rowtype; request_id uuid; result jsonb;
begin
 select * into strict actor from public.bidders where active and auth_user_id is not null limit 1;
 update public.bidders set role='intake' where id=actor.id;
 select r.id into strict request_id from public.leave_requests r join public.bidders b on b.id=r.bidder_id where r.status='approved' and b.area_id is distinct from actor.area_id limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
 result := private.admin_cancel_leave_requests_unchecked(array[request_id]);
 if (result->>'cancelled_count')::integer <> 1 then raise exception 'Cross-area removal failed'; end if;
 if (select status from public.leave_requests where id=request_id) <> 'cancelled' then raise exception 'Cancellation missing'; end if;
 if exists(select 1 from public.leave_slots where source_leave_request_id=request_id) then raise exception 'Slots not released'; end if;
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform private.admin_cancel_leave_requests_unchecked(array[request_id]);
  raise exception 'Unauthorized removal allowed';
 exception when others then
  if sqlerrm not like '%intake or an administrator%' then raise; end if;
 end;
end;
$test$;
rollback;
