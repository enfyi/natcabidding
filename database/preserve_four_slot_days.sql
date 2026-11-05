-- Preserve later fixes to the installed closure routine. Does not alter inventory.
begin;
do $upgrade$
declare definition text;
begin
  definition := pg_get_functiondef('private.apply_slot_closure_rule(integer,text,text)'::regprocedure);
  if position($new$    -- Four-slot dates retain all four slots, regardless of holiday metadata.
    if (case when rule.slot_group = 'cpc' then day.cpc else day.dev end) = 4
      then continue; end if;
$new$ in definition) > 0 then return; end if;
  if position($old$    -- Holiday weeks use Sunday-Saturday, matching the bidding calendar.
    if (case when rule.slot_group = 'cpc' then day.cpc else day.dev end) = 4
      and exists (select 1 from public.holidays h where h.bid_year_id = rule.bid_year_id
        and h.holiday_date between day.slot_date - extract(dow from day.slot_date)::integer
        and day.slot_date - extract(dow from day.slot_date)::integer + 6) then continue; end if;
$old$ in definition) = 0 then
    raise exception 'Unrecognized closure routine; review its four-slot guard before upgrading.';
  end if;
  execute replace(definition, $old$    -- Holiday weeks use Sunday-Saturday, matching the bidding calendar.
    if (case when rule.slot_group = 'cpc' then day.cpc else day.dev end) = 4
      and exists (select 1 from public.holidays h where h.bid_year_id = rule.bid_year_id
        and h.holiday_date between day.slot_date - extract(dow from day.slot_date)::integer
        and day.slot_date - extract(dow from day.slot_date)::integer + 6) then continue; end if;
$old$, $new$    -- Four-slot dates retain all four slots, regardless of holiday metadata.
    if (case when rule.slot_group = 'cpc' then day.cpc else day.dev end) = 4
      then continue; end if;
$new$);
end;
$upgrade$;
-- Reject DEV closure calls at the database boundary, including older clients.
do $cpc_only$
declare definition text;
begin
  definition := pg_get_functiondef('private.apply_slot_closure_rule(integer,text,text)'::regprocedure);
  if position('Unused slot closures apply only to CPC.' in definition) > 0 then return; end if;
  if position('  select r.* into strict rule from public.slot_closure_rules r' in definition) = 0 then
    raise exception 'Unrecognized closure routine; review its CPC guard before upgrading.';
  end if;
  execute replace(definition,
    '  select r.* into strict rule from public.slot_closure_rules r',
    $guard$  if requested_slot_group is distinct from 'cpc' then
    raise exception 'Unused slot closures apply only to CPC. DEV slots must remain unchanged.';
  end if;
  select r.* into strict rule from public.slot_closure_rules r$guard$);
end;
$cpc_only$;
commit;
