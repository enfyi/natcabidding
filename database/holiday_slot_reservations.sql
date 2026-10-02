-- Holiday and holiday-in-lieu leave uses the same daily inventory as other
-- selected non-RDO leave. Pending requests hold a real slot so the bidder's initials
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

  if coalesce((to_jsonb(request_row)->>'is_ghost_bid')::boolean, false)
     or bidder_row.bid_role = 'GL' then
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

  target_bucket := case
    when bidder_row.bid_role in ('R-DEV', 'D-DEV', 'DEV', 'TMCIT') then 'dev'
    else 'cpc'
  end;
  target_status := case when request_row.status = 'approved' then 'approved' else 'held' end;

  for request_date in
    select day.leave_date
    from public.leave_request_dates day
    where day.leave_request_id = request_row.id
      and not day.is_rdo
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

create or replace function private.prevent_gl_leave_slot_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_role text;
begin
  if new.source_leave_request_id is null then
    return new;
  end if;

  select bidder.bid_role
  into source_role
  from public.leave_requests request
  join public.bidders bidder on bidder.id = request.bidder_id
  where request.id = new.source_leave_request_id;

  if source_role is distinct from 'GL' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    return null;
  end if;

  new.bidder_id := null;
  new.slot_initials := null;
  new.status := 'open';
  new.source_leave_request_id := null;
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.prevent_gl_leave_slot_consumption()
from public, anon, authenticated;

drop trigger if exists prevent_gl_leave_slot_consumption on public.leave_slots;
create trigger prevent_gl_leave_slot_consumption
before insert or update of bidder_id, slot_initials, status, source_leave_request_id
on public.leave_slots
for each row execute function private.prevent_gl_leave_slot_consumption();

create or replace function private.sync_holiday_leave_slots_from_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if not old.is_rdo and (old.is_holiday or old.is_holiday_in_lieu) then
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
     and not old.is_rdo
     and (old.is_holiday or old.is_holiday_in_lieu)
     and (new.leave_date is distinct from old.leave_date
          or not (not new.is_rdo and (new.is_holiday or new.is_holiday_in_lieu))) then
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
after insert or update of charged, is_rdo, leave_date, is_holiday, is_holiday_in_lieu or delete
on public.leave_request_dates
for each row execute function private.sync_holiday_leave_slots_from_date();

drop trigger if exists sync_holiday_leave_slots_from_request on public.leave_requests;
create trigger sync_holiday_leave_slots_from_request
after update of status on public.leave_requests
for each row
when (old.status is distinct from new.status)
execute function private.sync_holiday_leave_slots_from_request();

-- Approval must promote this request's existing hold rather than claim a
-- second slot. Preserve all other installed reviewer rules.
do $upgrade$
declare
  definition text;
  original_filter text := 'and s.slot_date = date_row.leave_date and s.slot_group = bucket and s.status = ''open''';
begin
  definition := pg_get_functiondef('public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure);
  if position(original_filter in definition) > 0 then
    definition := replace(definition, original_filter,
      'and s.slot_date = date_row.leave_date and s.slot_group = bucket
          and (s.source_leave_request_id = leave_row.id or (s.status = ''open'' and s.bidder_id is null and s.source_leave_request_id is null))');
    definition := replace(definition, 'order by s.slot_code for update skip locked limit 1;',
      'order by (s.source_leave_request_id = leave_row.id) desc nulls last, s.slot_code for update skip locked limit 1;');
    execute definition;
  elsif position('s.source_leave_request_id = leave_row.id or' in definition) = 0 then
    raise exception 'Unrecognized leave approval slot check.';
  end if;
end;
$upgrade$;

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
      and not day.is_rdo
      and (day.is_holiday or day.is_holiday_in_lieu)
    order by request.id
  loop
    perform private.sync_holiday_leave_slots(request_id);
  end loop;
end
$block$;

comment on function private.sync_holiday_leave_slots(uuid) is
  'Reserves visible daily leave inventory for non-RDO holiday and holiday-in-lieu bids independently of charged hours, including pending holds.';
