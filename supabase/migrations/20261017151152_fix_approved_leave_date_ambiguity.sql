-- Patch the installed function so each environment retains its current round,
-- charging, capacity, and authorization rules. Both parameters also name columns
-- on existing_request, so the overlap query must use the local date aliases.
do $migration$
declare
  function_definition text;
  ambiguous_range constant text := 'existing_date.leave_date between requested_start_date and requested_end_date';
  replacement_range constant text := 'existing_date.leave_date between replacement_start_date and replacement_end_date';
begin
  function_definition := pg_catalog.pg_get_functiondef(
    'private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)'::regprocedure
  );
  if strpos(function_definition, ambiguous_range) > 0 then
    execute replace(function_definition, ambiguous_range, replacement_range);
  elsif strpos(function_definition, replacement_range) = 0 then
    raise exception 'Approved leave replacement overlap query was not found.';
  end if;
end;
$migration$;
