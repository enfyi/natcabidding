-- Run with an administrative connection, before or after the optimization.
-- Compare complete calendar JSON in one snapshot, including missing/null years.
begin isolation level repeatable read;
create temporary table calendar_query_results (
  bid_year integer,
  calendar_days integer,
  results_identical boolean
);
do $test$
declare
  original text;
  optimized text;
  year integer;
  before_result jsonb;
  after_result jsonb;
begin
  -- Include NULL, empty, exact-prefix, case, whitespace and embedded-prefix cases.
  if exists (
    select 1 from unnest(array[null, '', 'CAPACITY-', 'CAPACITY-1',
      'capacity-1', ' CAPACITY-1', 'XCAPACITY-1', 'CPC-1', E'CAPACITY-\n']) code
    where (code !~ '^CAPACITY-') is distinct from
      (not starts_with(code, 'CAPACITY-'))
  ) then
    raise exception 'Capacity-marker predicate changed';
  end if;

  select prosrc into original from pg_proc
    where oid = 'public.read_public_leave_slots(integer)'::regprocedure;
  original := replace(original,
    'not starts_with(slot.slot_code, ''CAPACITY-'')',
    'slot.slot_code !~ ''^CAPACITY-''');
  optimized := replace(original,
    'slot.slot_code !~ ''^CAPACITY-''',
    'not starts_with(slot.slot_code, ''CAPACITY-'')');

  for year in
    select bid_year from public.bid_years
    union select -1
    union select null::integer
  loop
    execute replace(original, 'requested_bid_year', coalesce(year::text, 'NULL::integer'))
      into before_result;
    execute replace(optimized, 'requested_bid_year', coalesce(year::text, 'NULL::integer'))
      into after_result;
    if before_result is distinct from after_result then
      raise exception 'Calendar output changed for year %', year;
    end if;
    insert into calendar_query_results values
      (year, jsonb_array_length(after_result), true);
  end loop;

  if not has_function_privilege('anon', 'public.read_public_leave_slots(integer)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.read_public_leave_slots(integer)', 'EXECUTE') then
    raise exception 'Calendar read permissions missing';
  end if;
end
$test$;
select * from calendar_query_results order by bid_year nulls last;
rollback;
