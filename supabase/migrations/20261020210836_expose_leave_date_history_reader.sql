
-- Older installations also need the public authenticated wrapper so the client
-- receives history instead of falling back to the legacy queue reader.
create or replace function public.read_leave_intake_queue_with_weeks(queue_bid_year integer default null)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  return private.read_leave_intake_queue_with_weeks(queue_bid_year);
end;
$function$;
revoke all on function public.read_leave_intake_queue_with_weeks(integer) from public, anon;
grant execute on function public.read_leave_intake_queue_with_weeks(integer) to authenticated;
