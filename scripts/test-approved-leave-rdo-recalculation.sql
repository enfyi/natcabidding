-- Run as database owner. Exercise the real assignment trigger and roll back
-- every date, charge, intake payload, and inventory update.
begin;
do $test$
declare
  candidate record;
  expected_days integer;
begin
  select l.id line_id, r.id request_id, r.bidder_id, r.bid_year_id
  into strict candidate
  from public.rdo_lines l
  join public.leave_requests r on r.bidder_id=l.assigned_bidder_id and r.bid_year_id=l.bid_year_id
  join public.bid_years y on y.id=r.bid_year_id
  where l.status='taken' and r.status='approved' and r.round_number=1 and y.status='open'
    and exists(select 1 from public.leave_request_dates d where d.leave_request_id=r.id)
  order by r.id limit 1;

  -- Mimic stale flags left by a previous schedule, after leave was approved.
  update public.leave_request_dates d set is_rdo=not exists(
    select 1 from public.rdo_line_days ld where ld.rdo_line_id=candidate.line_id
      and ld.is_rdo and ld.weekday=extract(dow from d.leave_date)::int
  ), charged=false where d.leave_request_id=candidate.request_id;
  update public.leave_requests set charged_days=0 where id=candidate.request_id;
  update public.intake_submissions set payload=jsonb_set(payload,'{days}','999'::jsonb)
    where leave_request_id=candidate.request_id;

  update public.rdo_lines set status='open' where id=candidate.line_id;
  update public.rdo_lines set status='taken' where id=candidate.line_id;

  if exists(select 1 from public.leave_request_dates d
    where d.leave_request_id=candidate.request_id and (d.is_rdo is distinct from exists(
      select 1 from public.rdo_line_days ld where ld.rdo_line_id=candidate.line_id
        and ld.is_rdo and ld.weekday=extract(dow from d.leave_date)::int
    ) or d.charged is distinct from not d.is_rdo)) then
    raise exception 'Approved date flags were not reconciled with assigned RDOs';
  end if;
  select count(*) into expected_days from public.leave_request_dates
    where leave_request_id=candidate.request_id and charged;
  if (select charged_days from public.leave_requests where id=candidate.request_id)<>expected_days then
    raise exception 'Approved charged-day count was not reconciled';
  end if;
  if exists(select 1 from public.intake_submissions where leave_request_id=candidate.request_id
    and payload->>'days' is distinct from expected_days::text) then
    raise exception 'Intake summary was not reconciled';
  end if;
  if (select status from public.leave_requests where id=candidate.request_id)<>'approved' then
    raise exception 'Recalculation changed the approval decision';
  end if;
end;
$test$;
rollback;
