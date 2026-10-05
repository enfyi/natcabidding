-- Preserve the currently installed review routine, including its fatigue
-- override checks, while allowing an unassigned group during Round 1.
do $migration$
declare
  routine_oid oid := to_regprocedure('public.review_bidding_submission(uuid,text,text,jsonb)');
  definition text;
  old_assignment constant text := 'requested_group := coalesce(override_payload->>''fatigueGroup'', submission.payload->>''fatigueGroup'');';
  old_validation constant text := 'if requested_group not in (''A'', ''B'', ''C'') then raise exception ''A valid fatigue group is required.''; end if;';
  old_capacity constant text := 'if line_row.line_type in (''CPC'', ''DEV'') then';
begin
  if routine_oid is null then
    raise exception 'review_bidding_submission is not installed';
  end if;

  definition := pg_get_functiondef(routine_oid);
  if position(old_assignment in definition) = 0
    or position(old_validation in definition) = 0
    or position(old_capacity in definition) = 0 then
    raise exception 'review_bidding_submission changed; review its fatigue-group validation before applying this migration';
  end if;

  definition := replace(definition, old_assignment,
    'requested_group := nullif(trim(coalesce(override_payload->>''fatigueGroup'', submission.payload->>''fatigueGroup'', '''')), '''');');
  definition := replace(definition, old_validation,
    'if requested_group is not null and requested_group not in (''A'', ''B'', ''C'') then raise exception ''Fatigue group must be A, B, or C.''; end if;');
  definition := replace(definition, old_capacity,
    'if requested_group is not null and line_row.line_type in (''CPC'', ''DEV'') then');

  execute definition;
end;
$migration$;
