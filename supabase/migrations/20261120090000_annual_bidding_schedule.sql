begin;
create function public.valid_bidding_schedule(events jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; previous_end date; start_date date; end_date date; first_date date;
begin
  if jsonb_typeof(events) <> 'array' or jsonb_array_length(events) not between 1 and 200 then return false; end if;
  for item in select value from jsonb_array_elements(events) order by value->>'start', value->>'end' loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'label') is distinct from 'string'
      or length(trim(item->>'label')) not between 1 and 100
      or coalesce(item->>'kind', '') not in ('round', 'validation', 'holiday', 'change')
      or coalesce(item->>'start', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or coalesce(item->>'end', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    start_date := (item->>'start')::date; end_date := (item->>'end')::date;
    if start_date > end_date or start_date <= previous_end then return false; end if;
    first_date := coalesce(first_date, start_date);
    if end_date - first_date > 366 then return false; end if;
    previous_end := end_date;
  end loop;
  return true;
exception when others then return false;
end $$;
create table public.bidding_schedules (
  bid_year integer primary key references public.bid_years(bid_year),
  draft_events jsonb not null check (public.valid_bidding_schedule(draft_events)),
  published_events jsonb check (published_events is null or public.valid_bidding_schedule(published_events)),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.bidding_schedules enable row level security;
revoke all on public.bidding_schedules from public, anon, authenticated;
grant select, insert, update on public.bidding_schedules to authenticated;
create policy "administrators manage annual bidding schedules" on public.bidding_schedules
  for all to authenticated using ((select public.is_current_admin())) with check ((select public.is_current_admin()));
-- Drafts stay private: the public reader exposes only the active year's published snapshot.
create function public.read_public_bidding_schedule() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('bid_year', s.bid_year, 'events', s.published_events)
  from public.bidding_schedules s
  join public.bid_years y on y.bid_year = s.bid_year
  join public.bidding_site_settings settings on settings.active_bid_year_id = y.id and settings.singleton
  where s.published_events is not null
$$;
revoke all on function public.read_public_bidding_schedule() from public;
grant execute on function public.read_public_bidding_schedule() to anon, authenticated;
commit;
