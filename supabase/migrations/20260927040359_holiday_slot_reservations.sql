-- Holiday and holiday-in-lieu leave uses the same daily inventory as other
-- charged leave. Pending requests hold a real slot so the bidder's initials
-- are visible immediately; approval promotes the hold to an approved slot.

create or replace function private.sync_holiday_leave_slots(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.leave_requests%rowtype;
  bidder_row public.bidders%rowtype;
  request_date record;
  target_bucket text;
  target_status text;
  selected_slot_id uuid;
begin
  select *
  into request_row
  from public.leave_requests request
  where request.id = target_request_id
  for update;

  if request_row.id is null then
    return;
  end if;

  if request_row.status not in ('pending', 'approved') then
    delete from public.leave_slots slot
    where slot.source_leave_request_id = request_row.id
      and slot.slot_code like 'OVERRIDE-%';

    update public.leave_slots slot
    set bidder_id = null,
        slot_initials = null,
        status = 'open',
        source_leave_request_id = null,
        updated_at = now()
    where slot.source_leave_request_id = request_row.id;
    return;
  end if;

  select *
  into strict bidder_row
  from public.bidders bidder
  where bidder.id = request_row.bidder_id;

  target_bucket := case
    when bidder_row.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
    else 'cpc'
  end;
  target_status := case when request_row.status = 'approved' then 'approved' else 'held' end;

  for request_date in
    select day.leave_date
    from public.leave_request_dates day
    where day.leave_request_id = request_row.id
      and day.charged
      and (day.is_holiday or day.is_holiday_in_lieu)
    order by day.leave_date
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        request_row.bid_year_id::text || ':' || bidder_row.area_id::text || ':' ||
        target_bucket || ':' || request_date.leave_date::text,
        0
      )
    );

    select slot.id
    into selected_slot_id
    from public.leave_slots slot
    where slot.source_leave_request_id = request_row.id
      and slot.slot_date = request_date.leave_date
      and slot.slot_group = target_bucket
    order by slot.slot_code
    limit 1
    for update;

    if selected_slot_id is null then
      select slot.id
      into selected_slot_id
      from public.leave_slots slot
      where slot.bid_year_id = request_row.bid_year_id
        and slot.area_id = bidder_row.area_id
        and slot.slot_date = request_date.leave_date
        and slot.slot_group = target_bucket
        and slot.status = 'open'
        and slot.bidder_id is null
        and slot.source_leave_request_id is null
      order by slot.slot_code
      limit 1
      for update skip locked;
    end if;

    if selected_slot_id is null then
      raise exception 'No % leave slot is available on % for holiday leave.',
        upper(target_bucket), to_char(request_date.leave_date, 'Mon FMDD, YYYY');
    end if;

    update public.leave_slots slot
    set bidder_id = bidder_row.id,
        slot_initials = bidder_row.initials,
        status = target_status,
        source_leave_request_id = request_row.id,
        updated_at = now()
    where slot.id = selected_slot_id;

    selected_slot_id := null;
  end loop;
end
$function$;

revoke all on function private.sync_holiday_leave_slots(uuid)
from public, anon, authenticated;

create or replace function private.sync_holiday_leave_slots_from_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.charged and (old.is_holiday or old.is_holiday_in_lieu) then
      update public.leave_slots slot
      set bidder_id = null,
          slot_initials = null,
          status = 'open',
          source_leave_request_id = null,
          updated_at = now()
      where slot.source_leave_request_id = old.leave_request_id
        and slot.slot_date = old.leave_date;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.charged
     and (old.is_holiday or old.is_holiday_in_lieu)
     and not (new.charged and (new.is_holiday or new.is_holiday_in_lieu)) then
    update public.leave_slots slot
    set bidder_id = null,
        slot_initials = null,
        status = 'open',
        source_leave_request_id = null,
        updated_at = now()
    where slot.source_leave_request_id = old.leave_request_id
      and slot.slot_date = old.leave_date;
  end if;

  perform private.sync_holiday_leave_slots(new.leave_request_id);
  return new;
end
$function$;

create or replace function private.sync_holiday_leave_slots_from_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.sync_holiday_leave_slots(new.id);
  return new;
end
$function$;

revoke all on function private.sync_holiday_leave_slots_from_date()
from public, anon, authenticated;
revoke all on function private.sync_holiday_leave_slots_from_request()
from public, anon, authenticated;

drop trigger if exists sync_holiday_leave_slots_from_date on public.leave_request_dates;
create trigger sync_holiday_leave_slots_from_date
after insert or update of charged, is_holiday, is_holiday_in_lieu or delete
on public.leave_request_dates
for each row execute function private.sync_holiday_leave_slots_from_date();

drop trigger if exists sync_holiday_leave_slots_from_request on public.leave_requests;
create trigger sync_holiday_leave_slots_from_request
after update of status on public.leave_requests
for each row
when (old.status is distinct from new.status)
execute function private.sync_holiday_leave_slots_from_request();

-- Repair active pilot bids created before holiday slot reservations were
-- enabled. The migration stops on a real capacity conflict instead of
-- silently increasing that day's configured capacity.
do $block$
declare
  request_id uuid;
begin
  for request_id in
    select distinct request.id
    from public.leave_requests request
    join public.leave_request_dates day on day.leave_request_id = request.id
    where request.status in ('pending', 'approved')
      and day.charged
      and (day.is_holiday or day.is_holiday_in_lieu)
    order by request.id
  loop
    perform private.sync_holiday_leave_slots(request_id);
  end loop;
end
$block$;

comment on function private.sync_holiday_leave_slots(uuid) is
  'Reserves visible daily leave inventory for charged holiday and holiday-in-lieu bids, including pending holds.';
