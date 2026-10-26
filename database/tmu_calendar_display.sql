-- Shared TMU calendar display preference. Install after bid_window_testing_admin.sql.
begin;
alter table public.bid_year_settings
  add column if not exists tmu_one_slot_outline boolean not null default true;

-- Keep the existing settings reader and its consumers compatible.
create or replace function public.read_calendar_year_settings(requested_bid_year integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(settings) || jsonb_build_object(
    'tmu_one_slot_outline', coalesce(display.tmu_one_slot_outline, true))
  from public.read_bid_year_settings(requested_bid_year) settings
  join public.bid_years y on y.bid_year = settings.bid_year
  left join public.bid_year_settings display on display.bid_year_id = y.id
$$;
revoke all on function public.read_calendar_year_settings(integer) from public, anon, authenticated;
grant execute on function public.read_calendar_year_settings(integer) to anon, authenticated;

create or replace function public.set_tmu_one_slot_outline(requested_bid_year integer, enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare target_year uuid;
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can change calendar display settings.';
  end if;
  if enabled is null then raise exception 'An on or off value is required.'; end if;
  select id into target_year from public.bid_years where bid_year = requested_bid_year;
  if target_year is null then raise exception 'Bid year does not exist.'; end if;
  insert into public.bid_year_settings(bid_year_id, tmu_one_slot_outline, updated_by)
  values(target_year, enabled, public.current_bidder_id())
  on conflict (bid_year_id) do update set
    tmu_one_slot_outline = excluded.tmu_one_slot_outline,
    updated_by = excluded.updated_by, updated_at = now();
end
$$;
revoke all on function public.set_tmu_one_slot_outline(integer, boolean) from public, anon, authenticated;
grant execute on function public.set_tmu_one_slot_outline(integer, boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
