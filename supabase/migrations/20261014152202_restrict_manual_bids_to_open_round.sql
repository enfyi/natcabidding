-- Manual entry bypasses the personal window, never the facility round.
-- Keep the manual role check and all existing bidding/editor business rules.
do $upgrade$
declare
  entry record;
  definition text;
  updated_definition text;
  patched integer := 0;
begin
  for entry in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('submit_rdo_bid','submit_leave_bid_batch')
  loop
    definition := pg_get_functiondef(entry.oid);
    updated_definition := replace(definition,
      E'if not manual_entry and enforce_bid_windows\n     and not public.is_area_bid_round_open',
      E'if enforce_bid_windows\n     and not public.is_area_bid_round_open');
    if position(E'if enforce_bid_windows\n     and not public.is_area_bid_round_open' in updated_definition)=0 then
      raise exception 'Expected facility round guard missing in %', entry.proname;
    end if;
    if position('private.assert_manual_bid_access(manual_entry)' in updated_definition)=0 then
      raise exception 'Expected manual authorization guard missing in %', entry.proname;
    end if;
    execute updated_definition;
    patched := patched + 1;
  end loop;
  if patched<>2 then raise exception 'Expected both public submission functions'; end if;
end;
$upgrade$;
