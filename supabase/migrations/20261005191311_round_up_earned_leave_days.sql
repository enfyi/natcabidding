-- Accrual hours remain unchanged; bids use the next whole scheduled day.
create or replace function private.rounded_leave_allowance_hours(
  accrued_hours integer,
  hours_per_day integer
)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case when coalesce(hours_per_day, 0) > 0
    then ceil(greatest(coalesce(accrued_hours, 0), 0)::numeric / hours_per_day)::integer * hours_per_day
    else 0 end
$function$;

revoke all on function private.rounded_leave_allowance_hours(integer, integer)
  from public, anon, authenticated;

-- Preserve the installed functions' validation, security, and grants while
-- changing only the effective base allowance used by each write path.
do $migration$
declare
  signature text;
  target_function regprocedure;
  definition text;
  updated_definition text;
begin
  foreach signature in array array[
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)',
    'private.save_bidder_editor(integer,uuid,jsonb,jsonb)',
    'private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)',
    'private.replace_bidder_editor_leave_dates(uuid,date,date,boolean,uuid)'
  ] loop
    target_function := to_regprocedure(signature);
    if target_function is null then
      if signature = 'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)' then
        raise exception 'The leave submission function must exist before rounding earned leave.';
      end if;
      continue;
    end if;

    definition := pg_catalog.pg_get_functiondef(target_function);
    updated_definition := replace(
      definition,
      'target.leave_slot_allowance + (available_credit_days * leave_hours_per_day)',
      'private.rounded_leave_allowance_hours(target.leave_slot_allowance, leave_hours_per_day) + (available_credit_days * leave_hours_per_day)'
    );
    updated_definition := replace(
      updated_definition,
      'target.leave_slot_allowance + credit_days * leave_hours_per_day',
      'private.rounded_leave_allowance_hours(target.leave_slot_allowance, leave_hours_per_day) + credit_days * leave_hours_per_day'
    );
    updated_definition := replace(
      updated_definition,
      'target.leave_slot_allowance+credit_days*day_hours',
      'private.rounded_leave_allowance_hours(target.leave_slot_allowance, day_hours)+credit_days*day_hours'
    );
    if updated_definition = definition
       and position('private.rounded_leave_allowance_hours(' in definition) = 0
       and signature in (
      'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)',
      'private.save_bidder_editor(integer,uuid,jsonb,jsonb)'
    ) then
      raise exception 'Could not locate the leave allowance check in %.', signature;
    end if;
    if updated_definition <> definition then
      execute updated_definition;
    end if;
  end loop;
end
$migration$;

-- Keep the round-four allowance view consistent where it is installed.
do $upgrade_view$
begin
  if to_regclass('private.round_four_allowances') is null
     or to_regprocedure('private.leave_hours_for_line(uuid)') is null then
    return;
  end if;
  execute $definition$
create or replace view private.round_four_allowances as
select year_row.id as bid_year_id,
       bidder.id as bidder_id,
       line.rdo_line_id,
       bidder.leave_slot_allowance as base_hours,
       private.round_four_credit_days(year_row.id, bidder.id) as returned_days,
       case when line.rdo_line_id is not null
         then private.leave_hours_for_line(line.rdo_line_id) end as hours_per_day,
       case when line.rdo_line_id is not null
         then private.round_four_credit_days(year_row.id, bidder.id)
              * private.leave_hours_for_line(line.rdo_line_id) end as returned_hours,
       case when line.rdo_line_id is not null
         then private.rounded_leave_allowance_hours(
                bidder.leave_slot_allowance,
                private.leave_hours_for_line(line.rdo_line_id)
              ) + private.round_four_credit_days(year_row.id, bidder.id)
                * private.leave_hours_for_line(line.rdo_line_id) end as total_hours
from public.bid_years year_row
cross join public.bidders bidder
left join lateral (
  select coalesce(
    (select assigned.id from public.rdo_lines assigned
     where assigned.bid_year_id = year_row.id
       and assigned.assigned_bidder_id = bidder.id and assigned.status = 'taken'
     order by assigned.updated_at desc, assigned.id limit 1),
    (select submitted.rdo_line_id from public.intake_submissions submitted
     where submitted.bid_year_id = year_row.id and submitted.bidder_id = bidder.id
       and submitted.submission_type = 'rdo'
       and submitted.status in ('pending', 'approved')
     order by submitted.reviewed_at desc nulls last,
       submitted.submitted_at desc nulls last, submitted.created_at desc
     limit 1)
  ) as rdo_line_id
) line on true
$definition$;

  revoke all on private.round_four_allowances from public, anon, authenticated;
end
$upgrade_view$;
