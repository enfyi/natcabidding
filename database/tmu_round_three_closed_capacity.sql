-- Preserve the installed review routine and its later fixes. Closed TMU Round 3
-- capacity cannot be bypassed by the intake capacity-override checkbox.
do $patch$
declare
  routine regprocedure := 'public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure;
  definition text;
  needle text := 'if not capacity_override then raise exception ''Leave capacity is full on %.'', date_row.leave_date; end if;';
begin
  select pg_get_functiondef(routine) into definition;
  if position('TMU Round 3 capacity is closed' in definition) > 0 then return; end if;
  if position(needle in definition) = 0 then
    raise exception 'Unexpected review routine: inspect capacity guard before installation.';
  end if;
  definition := replace(definition, needle, $guard$
          if leave_row.round_number = 3
             and exists (select 1 from public.areas a where a.id = target.area_id and lower(a.code) = 'tmu')
             and exists (
               select 1 from public.slot_closure_rules rule
               where rule.bid_year_id = submission.bid_year_id
                 and rule.area_id = target.area_id and rule.slot_group = bucket
                 and rule.applied_at is not null and rule.after_round < 3
             ) then
            raise exception 'TMU Round 3 capacity is closed on %. Choose a different date; capacity overrides are not permitted.', date_row.leave_date;
          end if;
          if not capacity_override then raise exception 'Leave capacity is full on %.', date_row.leave_date; end if;
  $guard$);
  execute definition;
end
$patch$;
