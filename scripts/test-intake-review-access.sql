-- Read-only integration checks: never approve or modify a real submission.
begin read only;
do $test$
declare
  actor public.bidders%rowtype;
  year_row public.bid_years%rowtype;
  expected_access boolean;
  actual integer;
  expected integer;
  tested integer := 0;
begin
  select y.* into strict year_row from public.bid_years y
  join public.bidding_site_settings settings on settings.active_bid_year_id = y.id
  where settings.singleton;

  for actor in select * from public.bidders where active and auth_user_id is not null loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', actor.auth_user_id, 'email', actor.email, 'role', 'authenticated'
    )::text, true);
    expected_access := actor.role in ('admin', 'intake') or exists (
      select 1 from public.intake_schedules schedule
      where schedule.intake_user_id = actor.id
        and (schedule.bid_year_id = year_row.id or schedule.bid_year_id is null)
        and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
    );
    if private.can_review_intake_year(year_row.id) is distinct from expected_access then
      raise exception 'Reviewer access mismatch for role %', actor.role;
    end if;

    select jsonb_array_length(public.read_bidding_state(year_row.bid_year)->'submissions') into actual;
    select count(*) into expected from public.intake_submissions s
    where s.bid_year_id = year_row.id and s.submission_type in ('rdo', 'leave')
      and (expected_access or (s.bidder_id = actor.id and s.area_id = actor.area_id));
    if actual <> expected then raise exception 'Submission queue visibility mismatch'; end if;

    select count(*) into actual from public.read_leave_intake_queue(year_row.bid_year)
    where status = 'approved';
    select count(*) into expected from public.leave_requests lr
    join public.bidders b on b.id = lr.bidder_id and b.active
    join public.areas a on a.id = b.area_id
    where lr.bid_year_id = year_row.id and lr.status = 'approved'
      and (expected_access or b.area_id = actor.area_id);
    if actual <> expected then raise exception 'Approved leave visibility mismatch'; end if;
    tested := tested + 1;
  end loop;
  if tested = 0 then raise exception 'No authenticated accounts tested'; end if;
  perform set_config('request.jwt.claims', '{}', true);
  if private.can_review_intake_year(year_row.id) then raise exception 'Anonymous reviewer access allowed'; end if;
  if position('private.can_review_intake_year(submission.bid_year_id)' in
    pg_get_functiondef('public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'Approval RPC does not use the shared reviewer check';
  end if;
end;
$test$;
select 'Intake approval permissions and approved queue visibility checks passed' as result;
rollback;
