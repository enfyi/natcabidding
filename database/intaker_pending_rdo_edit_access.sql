-- Scheduled intakers use the same authorization for edits and approvals.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.update_pending_rdo_submission(uuid,text,text,boolean,boolean,text)'::regprocedure);
  if position('private.can_review_intake_year(submission.bid_year_id)' in definition) = 0 then
    if position('actor.role not in (''admin'', ''intake'')' in definition) = 0 then
      raise exception 'Expected pending RDO authorization guard was not found.';
    end if;
    definition := replace(definition,
      'actor.id is null or actor.role not in (''admin'', ''intake'')', 'actor.id is null');
    definition := replace(definition,
      'if submission.status <> ''pending''',
      'if not private.can_review_intake_year(submission.bid_year_id) then
    raise exception ''Bidding reviewer access is required.'';
  end if;
  if submission.status <> ''pending''');
    if position('private.can_review_intake_year(submission.bid_year_id)' in definition) = 0 then
      raise exception 'Expected pending submission guard was not found.';
    end if;
    execute definition;
  end if;
end;
$migration$;
