-- Applied closure rules are authoritative in every subsequent bidding round.
-- Keep the installed reviewer, authorization, holiday handling, and TMU guard.
do $patch$
declare
  routine regprocedure := 'public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure;
  definition text;
  needle text := 'if not capacity_override then raise exception ''Leave capacity is full on %.'', date_row.leave_date; end if;';
begin
  select pg_get_functiondef(routine) into definition;
  if position('Applied slot closure capacity is full' in definition) > 0 then return; end if;
  if position(needle in definition) = 0 then
    raise exception 'Unexpected review routine: inspect capacity guard before installation.';
  end if;
  definition := replace(definition, needle, $guard$
          if exists (
            select 1 from public.slot_closure_rules rule
            where rule.bid_year_id = submission.bid_year_id
              and rule.area_id = target.area_id and rule.slot_group = bucket
              and rule.applied_at is not null
              and rule.after_round < leave_row.round_number
          ) then
            raise exception 'Applied slot closure capacity is full on %. Choose a different date; capacity overrides are not permitted.', date_row.leave_date;
          end if;
          if not capacity_override then raise exception 'Leave capacity is full on %.', date_row.leave_date; end if;
  $guard$);
  execute definition;
end
$patch$;
