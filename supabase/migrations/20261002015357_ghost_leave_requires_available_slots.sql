-- Ghost leave must have an available daily slot at submission. It never reserves
-- that slot; approval and personal allowance rules remain unchanged.
do $migration$
declare
  definition text;
  signature regprocedure := 'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)'::regprocedure;
  old_guard text := E'if not ghost_bid then\n    -- A configured row is one daily slot.';
  closing_guard text := E'    end if;\n  end if;\n\n  -- A date already submitted';
begin
  definition := pg_get_functiondef(signature);
  -- Newer round-rule installers already enforce daily availability for ghosts.
  if position(old_guard in definition) = 0
     and position('into capacity_conflict_dates' in definition) > 0
     and position('if not ghost_bid then' in definition) = 0 then return; end if;
  if position(old_guard in definition) = 0 or position(closing_guard in definition) = 0 then
    raise exception 'Could not locate ghost leave availability guard.';
  end if;
  definition := replace(definition, old_guard, '-- A configured row is one daily slot.');
  definition := replace(definition, closing_guard, E'    end if;\n\n  -- A date already submitted');
  execute definition;
end
$migration$;
