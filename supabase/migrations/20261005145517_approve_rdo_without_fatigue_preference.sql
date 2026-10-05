-- Preserve the currently installed review routine, including its fatigue
-- override checks, while allowing an unassigned group during Round 1.
do $migration$
declare
  routine_oid oid := to_regprocedure('public.review_bidding_submission(uuid,text,text,jsonb)');
  definition text;
  old_assignment constant text := 'requested_group := coalesce(override_payload->>''fatigueGroup'', submission.payload->>''fatigueGroup'');';
  old_validation constant text := 'if requested_group not in (''A'', ''B'', ''C'') then raise exception ''A valid fatigue group is required.''; end if;';
  old_capacity_block constant text := 'if line_row.line_type in (''CPC'', ''DEV'') then';
  old_capacity_inline constant text := 'if line_row.line_type in (''CPC'', ''DEV'') and not private.fatigue_group_is_available(';
  new_assignment constant text := 'requested_group := nullif(trim(coalesce(override_payload->>''fatigueGroup'', submission.payload->>''fatigueGroup'', '''')), '''');';
  new_validation constant text := 'if requested_group is not null and requested_group not in (''A'', ''B'', ''C'') then raise exception ''Fatigue group must be A, B, or C.''; end if;';
  new_capacity_block constant text := 'if requested_group is not null and line_row.line_type in (''CPC'', ''DEV'') then';
  new_capacity_inline constant text := 'if requested_group is not null and line_row.line_type in (''CPC'', ''DEV'') and not private.fatigue_group_is_available(';
begin
  if routine_oid is null then
    raise exception 'review_bidding_submission is not installed';
  end if;

  definition := pg_get_functiondef(routine_oid);
  if position(new_assignment in definition) > 0
    and position(new_validation in definition) > 0
    and (position(new_capacity_block in definition) > 0 or position(new_capacity_inline in definition) > 0) then
    return;
  end if;
  if position(old_assignment in definition) = 0
    or position(old_validation in definition) = 0
    or (position(old_capacity_block in definition) = 0 and position(old_capacity_inline in definition) = 0) then
    raise exception 'review_bidding_submission changed; review its fatigue-group validation before applying this migration';
  end if;

  definition := replace(definition, old_assignment, new_assignment);
  definition := replace(definition, old_validation, new_validation);
  if position(old_capacity_block in definition) > 0 then
    definition := replace(definition, old_capacity_block, new_capacity_block);
  else
    definition := replace(definition, old_capacity_inline, new_capacity_inline);
  end if;

  execute definition;
end;
$migration$;
