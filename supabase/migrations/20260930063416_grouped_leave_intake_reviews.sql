-- Atomically review the saved date requests shown as one week or batch.
-- Reuse the installed reviewer so all capacity, RDO, audit and slot rules apply.
create or replace function public.review_leave_submission_group(
  submission_ids uuid[], decision text, denial_reason_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  first_submission public.intake_submissions%rowtype;
  member public.intake_submissions%rowtype;
  selected_dates date[];
  member_count integer := 0;
begin
  select * into actor from public.bidders
  where auth_user_id = auth.uid() and lower(email) = lower(auth.jwt() ->> 'email') and active
  for update;
  if actor.id is null or actor.role not in ('admin', 'intake') then
    raise exception 'Bidding reviewer access is required.';
  end if;
  if decision is null or decision not in ('approved', 'denied') then
    raise exception 'Decision must be approved or denied.';
  end if;
  if decision = 'denied' and nullif(trim(denial_reason_text), '') is null then
    raise exception 'A denial reason is required.';
  end if;
  if coalesce(cardinality(submission_ids), 0) = 0 or cardinality(submission_ids) > 366
     or exists (select 1 from unnest(submission_ids) id where id is null)
     or (select count(distinct id) from unnest(submission_ids) id) <> cardinality(submission_ids) then
    raise exception 'Select distinct saved leave submissions to review.';
  end if;
  for member in
    select * from public.intake_submissions where id = any(submission_ids) order by id for update
  loop
    member_count := member_count + 1;
    if member.submission_type <> 'leave' or member.status <> 'pending' or member.leave_request_id is null then
      raise exception 'Only pending leave submissions can be reviewed as a group. Reload the queue.';
    end if;
    if first_submission.id is null then first_submission := member;
    elsif member.bidder_id is distinct from first_submission.bidder_id
       or member.bid_year_id is distinct from first_submission.bid_year_id
       or member.round_number is distinct from first_submission.round_number
       or member.submitted_at is distinct from first_submission.submitted_at then
      raise exception 'A group must belong to one bidder, round, and submitted batch.';
    end if;
  end loop;
  if member_count <> cardinality(submission_ids) then
    raise exception 'A saved leave submission could not be found. Reload the queue.';
  end if;
  if first_submission.round_number = 1 then
    select array_agg(distinct d.leave_date) into selected_dates
    from public.leave_request_dates d
    join public.intake_submissions s on s.leave_request_id = d.leave_request_id
    where s.id = any(submission_ids);
    if cardinality(private.round_one_week_bucket_starts(selected_dates)) <> 1 then
      raise exception 'Round 1 group approval must contain one seven-day bid week.';
    end if;
  end if;
  for member in
    select * from public.intake_submissions where id = any(submission_ids) order by id
  loop
    perform public.review_bidding_submission(member.id, decision, denial_reason_text, '{}'::jsonb);
  end loop;
  return jsonb_build_object('submission_ids', to_jsonb(submission_ids), 'status', decision);
end;
$function$;
revoke all on function public.review_leave_submission_group(uuid[],text,text) from public, anon;
grant execute on function public.review_leave_submission_group(uuid[],text,text) to authenticated;
