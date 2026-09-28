-- Permit system administrators to permanently remove an unused, open bid line.
-- Lines with an assignment or historical bidding/holiday references are protected.

revoke delete on public.rdo_lines, public.rdo_line_days from anon, authenticated;

create index if not exists intake_submissions_rdo_line_id_idx
  on public.intake_submissions(rdo_line_id);
create index if not exists holiday_in_lieu_days_source_rdo_line_id_idx
  on public.holiday_in_lieu_days(source_rdo_line_id);

create or replace function private.admin_delete_bid_line_impl(target_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  target_line public.rdo_lines%rowtype;
begin
  if not (select public.is_current_admin()) then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  if target_line_id is null then
    raise exception 'A bid-line ID is required.';
  end if;

  actor_profile_id := private.current_admin_profile_id();

  select rl.*
  into target_line
  from public.rdo_lines rl
  where rl.id = target_line_id
  for update;

  if not found then
    raise exception 'The selected bid line no longer exists.';
  end if;
  if target_line.status <> 'open' or target_line.assigned_bidder_id is not null then
    raise exception 'Line % cannot be deleted because it is assigned, taken, or locked.', target_line.line_code;
  end if;
  if exists (
    select 1
    from public.intake_submissions submission
    where submission.rdo_line_id = target_line.id
  ) then
    raise exception 'Line % cannot be deleted because it has bidding history.', target_line.line_code;
  end if;
  if exists (
    select 1
    from public.holiday_in_lieu_days holiday_credit
    where holiday_credit.source_rdo_line_id = target_line.id
  ) then
    raise exception 'Line % cannot be deleted because it is referenced by holiday history.', target_line.line_code;
  end if;

  delete from public.rdo_lines rl
  where rl.id = target_line.id;

  insert into public.audit_events (
    bid_year_id,
    area_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    target_line.bid_year_id,
    target_line.area_id,
    actor_profile_id,
    'bid_line.deleted',
    'rdo_lines',
    target_line.id,
    jsonb_build_object(
      'line_code', target_line.line_code,
      'line_type', target_line.line_type,
      'pattern', target_line.pattern
    )
  );

  return jsonb_build_object(
    'id', target_line.id,
    'line_code', target_line.line_code,
    'deleted', true
  );
end;
$$;

revoke execute on function private.admin_delete_bid_line_impl(uuid) from public, anon;
grant execute on function private.admin_delete_bid_line_impl(uuid) to authenticated;

create or replace function public.admin_delete_bid_line(target_line_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_delete_bid_line_impl(target_line_id);
$$;

revoke execute on function public.admin_delete_bid_line(uuid) from public, anon;
grant execute on function public.admin_delete_bid_line(uuid) to authenticated;

comment on function public.admin_delete_bid_line(uuid) is
  'Permanently deletes an unused open RDO bid line for an authenticated system administrator.';
