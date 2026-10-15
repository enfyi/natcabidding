-- Keep approved and pending leave consistent after an assigned line changes.
-- Retain the existing trigger name and privilege boundary.
create or replace function private.recalculate_pending_leave_after_rdo_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status <> 'taken' or new.assigned_bidder_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = new.status
       and old.assigned_bidder_id is not distinct from new.assigned_bidder_id then
      return new;
    end if;
  end if;

  update public.leave_request_dates lrd
  set is_rdo = exists (
        select 1
        from public.rdo_line_days line_day
        where line_day.rdo_line_id = new.id
          and line_day.is_rdo
          and line_day.weekday = extract(dow from lrd.leave_date)::smallint
      ),
      charged = not (
          lr.round_number = 1
          and exists (
            select 1
            from public.rdo_line_days line_day
            where line_day.rdo_line_id = new.id
              and line_day.is_rdo
              and line_day.weekday = extract(dow from lrd.leave_date)::smallint
          )
        )
        and (lr.round_number <= 3
          or (not lrd.is_holiday and not lrd.is_holiday_in_lieu))
  from public.leave_requests lr
  where lrd.leave_request_id = lr.id
    and lr.bid_year_id = new.bid_year_id
    and lr.bidder_id = new.assigned_bidder_id
    and lr.status in ('pending', 'approved');

  update public.leave_requests lr
  set charged_days = coalesce((
        select count(*)::integer
        from public.leave_request_dates lrd
        where lrd.leave_request_id = lr.id
          and lrd.charged
      ), 0),
      updated_at = now()
  where lr.bid_year_id = new.bid_year_id
    and lr.bidder_id = new.assigned_bidder_id
    and lr.status in ('pending', 'approved');

  -- Intake payloads also expose the charged-day count.
  update public.intake_submissions submission
  set payload = jsonb_set(coalesce(submission.payload, '{}'::jsonb), '{days}', to_jsonb(request.charged_days)),
      updated_at = now()
  from public.leave_requests request
  where submission.leave_request_id = request.id
    and request.bid_year_id = new.bid_year_id
    and request.bidder_id = new.assigned_bidder_id
    and request.status in ('pending', 'approved')
    and submission.payload->>'days' is distinct from request.charged_days::text;

  return new;
end
$function$;

revoke all on function private.recalculate_pending_leave_after_rdo_assignment()
from public, anon, authenticated;

-- Repair existing mismatches in open years only. Snapshot affected requests
-- before updating dates, and preserve submitted dates and approval decisions.
create temporary table rdo_leave_repair on commit drop as
select d.id date_id, r.id request_id, r.bid_year_id, b.area_id,
       r.charged_days old_charged_days,
       exists(select 1 from public.rdo_line_days ld
         where ld.rdo_line_id=l.id and ld.is_rdo
           and ld.weekday=extract(dow from d.leave_date)::int) expected_rdo
from public.leave_request_dates d
join public.leave_requests r on r.id=d.leave_request_id
join public.bidders b on b.id=r.bidder_id
join public.rdo_lines l on l.assigned_bidder_id=b.id and l.bid_year_id=r.bid_year_id and l.status='taken'
join public.bid_years y on y.id=r.bid_year_id
where r.status in ('pending','approved') and y.status='open'
  and d.is_rdo is distinct from exists(select 1 from public.rdo_line_days ld
    where ld.rdo_line_id=l.id and ld.is_rdo
      and ld.weekday=extract(dow from d.leave_date)::int);

update public.leave_request_dates d
set is_rdo=repair.expected_rdo,
    charged=not (r.round_number=1 and repair.expected_rdo)
      and (r.round_number<=3 or (not d.is_holiday and not d.is_holiday_in_lieu))
from rdo_leave_repair repair, public.leave_requests r
where d.id=repair.date_id and r.id=d.leave_request_id;

update public.leave_requests r
set charged_days=(select count(*)::int from public.leave_request_dates d where d.leave_request_id=r.id and d.charged),
    updated_at=now()
where r.id in (select request_id from rdo_leave_repair);

update public.intake_submissions s
set payload=jsonb_set(coalesce(s.payload,'{}'::jsonb),'{days}',to_jsonb(r.charged_days)),updated_at=now()
from public.leave_requests r
where s.leave_request_id=r.id and r.id in (select request_id from rdo_leave_repair)
  and s.payload->>'days' is distinct from r.charged_days::text;

insert into public.audit_events (bid_year_id,area_id,event_type,entity_table,entity_id,details)
select distinct repair.bid_year_id,repair.area_id,'leave_rdo_flags_reconciled',
       'leave_requests',repair.request_id,
       jsonb_build_object('reason','Reconcile approved leave with current assigned RDO line',
         'old_charged_days',repair.old_charged_days,'charged_days',r.charged_days)
from rdo_leave_repair repair join public.leave_requests r on r.id=repair.request_id;
