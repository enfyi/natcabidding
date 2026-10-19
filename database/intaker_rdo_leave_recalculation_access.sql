-- RDO editor saves recalculate existing leave through this private helper.
-- Match its area access to the shared intake editor while preserving all
-- authentication, active-intake, target, capacity, and leave-rule checks.
do $migration$
declare
  definition text;
  old_check text := $check$  if actor.role <> 'admin' and actor.area_id is distinct from target.area_id then
    raise exception 'Intake users can only replace approved leave in their own area.';
  end if;$check$;
begin
  definition := pg_get_functiondef(
    'private.replace_bidder_editor_leave_dates(uuid,date,date,boolean,uuid)'::regprocedure);
  if position(old_check in definition) > 0 then
    execute replace(definition, old_check, '');
  elsif position('actor.area_id is distinct from target.area_id' in definition) > 0 then
    raise exception 'Unexpected leave helper permission check; review before updating.';
  end if;
end;
$migration$;
