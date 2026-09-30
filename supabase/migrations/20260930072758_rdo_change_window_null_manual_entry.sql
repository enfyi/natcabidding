do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)'::regprocedure) into definition;
 if position('if not (manual_entry and actor.role in (''admin'', ''intake''))' in definition)>0 then
  definition := replace(definition, 'if not (manual_entry and actor.role in (''admin'', ''intake''))', 'if not (coalesce(manual_entry, false) and actor.role in (''admin'', ''intake''))');
  execute definition;
 elsif position('if not (coalesce(manual_entry, false) and actor.role in (''admin'', ''intake''))' in definition)=0 then
  raise exception 'RDO change-window guard was not found.';
 end if;
end;
$migration$;
