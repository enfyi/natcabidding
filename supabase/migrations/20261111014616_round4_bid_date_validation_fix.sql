-- Round 4 bid-date validation and deferred holiday credits.
begin;

-- Round 4 holidays remain charged; their credit starts in Round 5.
-- Keep earlier Round 1-3 credits available from Round 4 as before.
create or replace function private.holiday_credit_days_for_round(
  year_id uuid, target_bidder_id uuid, target_round integer
)
returns integer language sql stable set search_path = '' as $function$
  select case when target_round < 4 then 0 else (
    select count(distinct day.leave_date)::integer
    from public.leave_request_dates day
    join public.leave_requests request on request.id = day.leave_request_id
    where request.bid_year_id = year_id and request.bidder_id = target_bidder_id
      and request.round_number between 1 and least(target_round - 1, 4)
      and request.status in ('pending', 'approved')
      and day.charged and (day.is_holiday or day.is_holiday_in_lieu)
  ) + (
    select coalesce(sum(event.credit_days), 0)::integer
    from public.leave_credit_events event
    where event.bid_year_id = year_id and event.bidder_id = target_bidder_id
      and event.round_number <= target_round and event.source = 'manual_adjustment'
  ) end
$function$;
revoke all on function private.holiday_credit_days_for_round(uuid, uuid, integer)
from public, anon, authenticated;

-- Preserve current authorization, capacity, rounding and over-accrual rules.
-- Change only holiday charging and the round in which its credit is available.
do $upgrade$
declare
  signature text;
  routine regprocedure;
  definition text;
begin
  foreach signature in array array[
    'private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)',
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)',
    'private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)',
    'private.replace_bidder_editor_leave_dates(uuid,date,date,boolean,uuid)',
    'private.save_bidder_editor(integer,uuid,jsonb,jsonb)',
    'public.refresh_bidder_holiday_in_lieu(uuid,uuid)',
    'private.recalculate_pending_leave_after_rdo_assignment()',
    'private.assert_leave_approval_allowance(uuid,uuid,integer)'
  ] loop
    routine := to_regprocedure(signature);
    if routine is null then raise exception 'Required bidding routine missing: %', signature; end if;
    definition := pg_get_functiondef(routine);
    definition := replace(definition, 'round_no <= 3', 'round_no <= 4');
    definition := replace(definition, 'batch_round <= 3', 'batch_round <= 4');
    definition := replace(definition, 'request_row.round_number <= 3', 'request_row.round_number <= 4');
    definition := replace(definition, 'request.round_number <= 3', 'request.round_number <= 4');
    definition := replace(definition, 'lr.round_number <= 3', 'lr.round_number <= 4');
    definition := replace(definition,
      'select allowance.returned_days into available_credit_days
    from private.round_four_allowances allowance
    where allowance.bid_year_id = year_row.id and allowance.bidder_id = target.id;',
      'available_credit_days := private.holiday_credit_days_for_round(year_row.id, target.id, batch_round);');
    definition := replace(definition,
      'private.round_four_credit_days(request_row.bid_year_id, target.id)',
      'private.holiday_credit_days_for_round(request_row.bid_year_id, target.id, check_round)');
    definition := replace(definition,
      'private.round_four_credit_days(year_id, target.id)',
      'private.holiday_credit_days_for_round(year_id, target.id, round_no)');
    definition := replace(definition,
      'private.round_four_credit_days(year_id,bidder_to_review)',
      'private.holiday_credit_days_for_round(year_id,bidder_to_review,round_no)');
    if signature = 'private.save_bidder_editor(integer,uuid,jsonb,jsonb)' then
      definition := replace(definition, 'request.round_number between 1 and 3',
        'request.round_number between 1 and least(round_no - 1, 4)');
    end if;
    execute definition;
  end loop;
end
$upgrade$;

-- Repair previously uncharged Round 4 holiday bids without releasing slots.
update public.leave_request_dates day
set charged = true
from public.leave_requests request
where request.id = day.leave_request_id and request.round_number = 4
  and not day.is_rdo and (day.is_holiday or day.is_holiday_in_lieu)
  and not day.charged;

update public.leave_requests request
set charged_days = (select count(*)::integer from public.leave_request_dates day
                    where day.leave_request_id = request.id and day.charged),
    updated_at = now()
where request.round_number = 4
  and request.charged_days is distinct from
    (select count(*)::integer from public.leave_request_dates day
     where day.leave_request_id = request.id and day.charged);

update public.intake_submissions submission
set payload = jsonb_set(coalesce(submission.payload, '{}'::jsonb), '{days}', to_jsonb(request.charged_days)),
    updated_at = now()
from public.leave_requests request
where submission.leave_request_id = request.id and request.round_number = 4
  and submission.submission_type = 'leave'
  and submission.payload->>'days' is distinct from request.charged_days::text;

commit;
