-- Shared intake reviewers can edit active bidders across areas, just as they
-- can review the shared intake queue. Retain existing actor authentication,
-- active-schedule checks, target activity checks, and function privileges.
do $migration$
declare
  definition text;
  signature text;
begin
  foreach signature in array array[
    'private.bidder_editor_actor(uuid)',
    'public.read_admin_bidder_editor(integer,uuid,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('(actor.role=''admin'' or b.area_id=actor.area_id)' in definition) > 0 then
      definition := replace(definition,
        'and (actor.role=''admin'' or b.area_id=actor.area_id)', '');
      execute definition;
    end if;
  end loop;
end;
$migration$;
