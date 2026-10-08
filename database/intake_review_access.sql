-- Keep queue reads and decisions aligned with permanent and scheduled Intake access.
create or replace function private.can_review_intake_year(requested_year_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.bidders actor
    where actor.auth_user_id = auth.uid()
      and lower(actor.email) = lower(auth.jwt() ->> 'email')
      and actor.active
      and (
        actor.role in ('admin', 'intake')
        or exists (
          select 1 from public.intake_schedules schedule
          where schedule.intake_user_id = actor.id
            and (schedule.bid_year_id = requested_year_id or schedule.bid_year_id is null)
            and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
        )
      )
  );
$$;

-- Only the existing authenticated, security-definer RPCs call this helper.
revoke all on function private.can_review_intake_year(uuid) from public, anon, authenticated;

do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure);
  if position('private.can_review_intake_year(submission.bid_year_id)' in definition) = 0 then
    if position('actor.role not in (''admin'', ''intake'')' in definition) = 0 then
      raise exception 'Expected review authorization guard was not found.';
    end if;
    definition := replace(definition,
      'actor.id is null or actor.role not in (''admin'', ''intake'')',
      'actor.id is null');
    definition := replace(definition,
      'if submission.status <> ''pending'' then',
      'if not private.can_review_intake_year(submission.bid_year_id) then
    raise exception ''Bidding reviewer access is required.'';
  end if;
  if submission.status <> ''pending'' then');
    if position('private.can_review_intake_year(submission.bid_year_id)' in definition) = 0 then
      raise exception 'Expected submission review guard was not found.';
    end if;
    execute definition;
  end if;

  definition := pg_get_functiondef('public.read_bidding_state(integer)'::regprocedure);
  if position('private.can_review_intake_year(year_id)' in definition) = 0 then
    if position('actor.role in (''admin'', ''intake'')' in definition) = 0 then
      raise exception 'Expected bidding state authorization guard was not found.';
    end if;
    execute replace(definition,
      'actor.role in (''admin'', ''intake'')',
      'private.can_review_intake_year(year_id)');
  end if;

  definition := pg_get_functiondef('public.read_leave_intake_queue(integer)'::regprocedure);
  if position('private.can_review_intake_year(lr.bid_year_id)' in definition) = 0 then
    if position('public.is_current_admin()' in definition) = 0 then
      raise exception 'Expected leave queue authorization guard was not found.';
    end if;
    execute replace(definition,
      'public.is_current_admin()',
      'private.can_review_intake_year(lr.bid_year_id)');
  end if;
end;
$migration$;
