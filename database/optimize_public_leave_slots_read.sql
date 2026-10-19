-- Replace repeated regular-expression checks with a literal prefix check.
-- CREATE OR REPLACE preserves the deployed function's owner and grants.
-- No bidding records, permissions, or calendar output fields are changed.
begin;
set local lock_timeout = '3s';
do $upgrade$
declare
  definition text;
begin
  select pg_get_functiondef('public.read_public_leave_slots(integer)'::regprocedure)
    into definition;
  if position('slot.slot_code !~ ''^CAPACITY-''' in definition) = 0 then
    if position('not starts_with(slot.slot_code, ''CAPACITY-'')' in definition) > 0 then
      return; -- Already installed.
    end if;
    raise exception 'Unexpected calendar function definition; review before upgrading';
  end if;
  execute replace(definition,
    'slot.slot_code !~ ''^CAPACITY-''',
    'not starts_with(slot.slot_code, ''CAPACITY-'')');
end
$upgrade$;
commit;
