-- Change only reservation timing. Leave dates, charged hours, area balances,
-- and Round 4 holiday credits remain authoritative and are not rewritten.
-- Preserve installed role/ghost compatibility rules in the sync routine.
do $upgrade$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.sync_holiday_leave_slots(uuid)'::regprocedure);
  if position('request_row.status not in (''pending'', ''approved'')' in definition) > 0 then
    definition := replace(definition,
      'request_row.status not in (''pending'', ''approved'')',
      'request_row.status <> ''approved''');
    definition := replace(definition,
      'target_status := case when request_row.status = ''approved'' then ''approved'' else ''held'' end;',
      'target_status := ''approved'';');
    execute definition;
  elsif position('request_row.status <> ''approved''' in definition) = 0 then
    raise exception 'Unrecognized holiday slot sync status guard.';
  end if;
end
$upgrade$;

-- Release existing holiday holds only; approved allocations remain assigned.
-- Use the same request lock as approval before releasing each reservation.
do $repair$
declare
  request_id uuid;
begin
  for request_id in
    select request.id
    from public.leave_requests request
    where request.status = 'pending'
      and exists (
        select 1 from public.leave_slots slot
        where slot.source_leave_request_id = request.id
          and slot.status in ('held', 'pending')
          and exists (
            select 1 from public.leave_request_dates day
            where day.leave_request_id = request.id
              and day.leave_date = slot.slot_date
              and not day.is_rdo
              and (day.is_holiday or day.is_holiday_in_lieu)
          )
      )
    order by request.id
    for update
  loop
    perform private.sync_holiday_leave_slots(request_id);
  end loop;
end
$repair$;

comment on function private.sync_holiday_leave_slots(uuid) is
  'Allocates non-RDO holiday and holiday-in-lieu daily slots only on approval; pending requests retain leave accounting without daily slot holds.';
