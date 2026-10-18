-- Exercise recipient lookup only: no messages sent and no bidding data changed.
begin read only;
do $test$
declare
  actor public.bidders%rowtype;
  recipient public.bidders%rowtype;
  recipient_area text;
  allowed boolean;
  actual integer;
  tested integer := 0;
  cross_area_tested integer := 0;
  denied_tested integer := 0;
begin
  select b.* into strict recipient from public.bidders b
  join public.areas a on a.id = b.area_id
  where b.active and b.initials = 'VC' and a.name = 'Area A';
  select name into strict recipient_area from public.areas where id = recipient.area_id;
  if nullif(trim(recipient.email), '') is null then
    raise exception 'Recipient fixture needs an email';
  end if;
  for actor in select * from public.bidders where active and auth_user_id is not null loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', actor.auth_user_id, 'email', actor.email, 'role', 'authenticated'
    )::text, true);
    allowed := actor.id = recipient.id or actor.role in ('admin', 'intake') or exists (
      select 1 from public.intake_submissions submission
      join public.intake_schedules schedule on schedule.intake_user_id = actor.id
        and (schedule.bid_year_id = submission.bid_year_id or schedule.bid_year_id is null)
      where submission.bidder_id = recipient.id
        and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
    );
    select count(*) into actual
    from public.resolve_bid_notification_recipient(recipient_area, recipient.initials)
    where recipient_email = recipient.email;
    if actual <> (case when allowed then 1 else 0 end) then
      raise exception 'Notification access mismatch for % (%)', actor.initials, actor.role;
    end if;
    if actor.role = 'intake' and actor.area_id <> recipient.area_id then
      cross_area_tested := cross_area_tested + 1;
    end if;
    if not allowed then denied_tested := denied_tested + 1; end if;
    -- A roster/login identity mismatch must not expose recipient addresses.
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', actor.auth_user_id, 'email', 'mismatch@example.invalid', 'role', 'authenticated'
    )::text, true);
    if exists (select 1 from public.resolve_bid_notification_recipient(recipient_area, recipient.initials)) then
      raise exception 'Mismatched identity allowed';
    end if;
    tested := tested + 1;
  end loop;
  if tested = 0 or cross_area_tested = 0 or denied_tested = 0 then
    raise exception 'Missing authorized/unauthorized account coverage';
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.resolve_bid_notification_recipient(recipient_area, recipient.initials);
    raise exception 'Anonymous lookup allowed';
  exception when raise_exception then
    if sqlerrm <> 'Authentication is required.' then raise; end if;
  end;
end;
$test$;
select 'Bid email cross-area, reviewer, identity and anonymous checks passed' as result;
rollback;
