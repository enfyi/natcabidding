-- Pilot database maintenance: fix the legacy RDO assignment trigger.
-- Run as the database administrator. Locks prevent concurrent writes while
-- pilot access guards are suspended; all guards are restored before commit.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';
lock table public.leave_requests, public.intake_submissions in access exclusive mode;
alter table public.leave_requests disable trigger enforce_pilot_leave_request_writes;
alter table public.intake_submissions disable trigger enforce_pilot_intake_submission_writes;
alter table public.leave_requests disable trigger enforce_pilot_leave_round;
alter table public.intake_submissions disable trigger enforce_pilot_intake_round;
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
    and lr.status = 'pending';

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
    and lr.status = 'pending';

  return new;
end
$function$;


update public.leave_request_dates d set charged = true
from public.leave_requests r
where d.leave_request_id = r.id and r.round_number between 1 and 3
and r.status in ('pending','approved') and not d.is_rdo and not d.charged;
update public.leave_requests r
set charged_days = (select count(*)::integer from public.leave_request_dates d where d.leave_request_id=r.id and d.charged), updated_at=now()
where r.round_number between 1 and 3 and r.status in ('pending','approved')
and r.charged_days is distinct from (select count(*)::integer from public.leave_request_dates d where d.leave_request_id=r.id and d.charged);
update public.intake_submissions s
set payload=jsonb_set(coalesce(s.payload,'{}'::jsonb),'{days}',to_jsonb(r.charged_days)),updated_at=now()
from public.leave_requests r where s.leave_request_id=r.id and r.round_number between 1 and 3
and r.status in ('pending','approved') and s.payload->>'days' is distinct from r.charged_days::text;
alter table public.leave_requests enable trigger enforce_pilot_leave_request_writes;
alter table public.intake_submissions enable trigger enforce_pilot_intake_submission_writes;
alter table public.leave_requests enable trigger enforce_pilot_leave_round;
alter table public.intake_submissions enable trigger enforce_pilot_intake_round;
commit;
