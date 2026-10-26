-- Shared intake removal uses the same cross-area access as date editing.
do $migration$
declare
  definition text;
  old_check text := $check$    if actor.role <> 'admin'
       and actor.area_id is distinct from target.area_id then
      raise exception 'Intake users can only remove approved leave in their own area.';
    end if;$check$;
begin
  definition := pg_get_functiondef('private.admin_cancel_leave_requests_unchecked(uuid[])'::regprocedure);
  if position(old_check in definition) > 0 then
    execute replace(definition, old_check, '');
  elsif position('actor.area_id' in definition) > 0 then
    raise exception 'Unexpected removal permission check; review before updating.';
  end if;
end;
$migration$;
