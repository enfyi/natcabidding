-- Preserve installed admin permissions, leave validation, and audit logic.
do $migration$
declare
  routine_oid oid := to_regprocedure('private.save_bidder_editor(integer,uuid,jsonb,jsonb)');
  definition text;
  old_assignment constant text := 'group_name := line_change->>''fatigue_group'';';
  old_validation constant text := 'if group_name is null or group_name not in (''A'',''B'',''C'') then raise exception ''Choose fatigue group A, B, or C.''; end if;';
  old_capacity constant text := 'if line_row.line_type in (''CPC'',''DEV'') and target.bid_role <> ''GL''';
begin
  if routine_oid is null then raise exception 'Admin bidder editor is not installed'; end if;
  definition := pg_get_functiondef(routine_oid);
  if position(old_assignment in definition) = 0 or position(old_validation in definition) = 0
    or position(old_capacity in definition) = 0 then
    raise exception 'Admin bidder editor changed; review fatigue validation before applying';
  end if;
  definition := replace(definition, old_assignment,
    'group_name := nullif(trim(line_change->>''fatigue_group''), '''');');
  definition := replace(definition, old_validation,
    'if group_name is not null and group_name not in (''A'',''B'',''C'') then raise exception ''Choose fatigue group A, B, C, or No preference.''; end if;');
  definition := replace(definition, old_capacity,
    'if group_name is not null and line_row.line_type in (''CPC'',''DEV'') and target.bid_role <> ''GL''');
  execute definition;
end;
$migration$;
