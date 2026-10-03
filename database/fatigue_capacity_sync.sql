-- Run after fatigue_group_balancing.sql and after any script replacing these RPCs.
-- Upgrade only the legacy capacity blocks, preserving deployed window, leave,
-- audit, eligibility, and permission logic. Re-running this script is safe.
begin;
do $sync$
declare
  routine record;
  definition text;
  updated text;
  capacity_pattern text := 'select greatest\(1, floor\(count\(\*\)::numeric / 3\)::integer\) into area_max.*?raise exception ''Fatigue group % is full for this area or crew.'', (requested_fatigue_group|requested_group);[[:space:]]*end if;';
  replacement text;
begin
  for routine in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('submit_rdo_bid', 'review_bidding_submission')
  loop
    definition := pg_get_functiondef(routine.oid);
    if position('private.fatigue_group_is_available(' in definition) > 0 then
      continue;
    end if;
    if routine.proname = 'submit_rdo_bid' then
      replacement := 'if requested_fatigue_group is not null and not private.fatigue_group_is_available(year_row.id, target.area_id, line_row.id, requested_fatigue_group, target.id) then
      raise exception ''Fatigue group % is full for this area or RDO set.'', requested_fatigue_group;
    end if;';
    else
      replacement := 'if not private.fatigue_group_is_available(submission.bid_year_id, target.area_id, line_row.id, requested_group, target.id) then
          raise exception ''Fatigue group % is full for this area or RDO set.'', requested_group;
        end if;';
    end if;
    updated := regexp_replace(definition, capacity_pattern, replacement, 's');
    if updated = definition then
      raise exception 'Unrecognized fatigue capacity block in %. No changes applied.', routine.proname;
    end if;
    updated := replace(updated, 'if line_row.line_type = ''CPC''', 'if line_row.line_type in (''CPC'', ''DEV'')');
    execute updated;
  end loop;
end;
$sync$;
commit;
