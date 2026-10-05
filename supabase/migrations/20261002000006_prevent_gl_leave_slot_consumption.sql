-- GL leave stays visible through leave_requests, but it must never occupy one
-- of the area's CPC or developmental leave_slots.
create or replace function private.prevent_gl_leave_slot_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_role text;
begin
  select bidder.bid_role
  into source_role
  from public.bidders bidder
  where bidder.id = coalesce(
    (
      select request.bidder_id
      from public.leave_requests request
      where request.id = new.source_leave_request_id
    ),
    new.bidder_id
  );

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

-- Remove extra override rows first, then reopen normal CPC/DEV slots that were
-- historically assigned to a GL bidder before the trigger existed.
delete from public.leave_slots slot
where slot.slot_code like 'OVERRIDE-%'
  and exists (
    select 1
    from public.bidders bidder
    where bidder.bid_role = 'GL'
      and bidder.id = coalesce(
        (
          select request.bidder_id
          from public.leave_requests request
          where request.id = slot.source_leave_request_id
        ),
        slot.bidder_id
      )
  );

update public.leave_slots slot
set bidder_id = null,
    slot_initials = null,
    status = 'open',
    source_leave_request_id = null,
    updated_at = now()
where exists (
  select 1
  from public.bidders bidder
  where bidder.bid_role = 'GL'
    and bidder.id = coalesce(
      (
        select request.bidder_id
        from public.leave_requests request
        where request.id = slot.source_leave_request_id
      ),
      slot.bidder_id
    )
);

comment on function private.prevent_gl_leave_slot_consumption() is
  'Keeps GL leave visible without consuming CPC or developmental leave slots.';
