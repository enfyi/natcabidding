-- Public announcement content; only system administrators can edit it.
begin;
create table public.round_announcements (
  bid_year integer not null references public.bid_years(bid_year),
  round_number integer not null check (round_number between 1 and 6),
  enabled boolean not null default false,
  color text not null default 'amber' check (color in ('amber', 'blue')),
  mode text not null default 'automatic' check (mode in ('automatic', 'manual')),
  title text not null check (length(trim(title)) between 1 and 300),
  body text not null default '' check (length(body) <= 1000),
  public_link_label text not null check (length(trim(public_link_label)) between 1 and 100),
  public_link_url text not null check (length(public_link_url) between 1 and 2000),
  member_link_label text not null check (length(trim(member_link_label)) between 1 and 100),
  member_link_url text not null check (length(member_link_url) between 1 and 2000),
  starts_at timestamptz,
  ends_at timestamptz,
  primary key (bid_year, round_number),
  check (not enabled or mode <> 'manual' or (starts_at is not null and ends_at is not null and starts_at < ends_at)),
  check (not enabled or mode <> 'automatic' or round_number <> 1 or starts_at is not null),
  -- Allow HTTP(S) and relative URLs, never executable schemes or protocol-relative URLs.
  check (public_link_url !~ '[[:space:]\\]' and public_link_url !~ '^//' and (public_link_url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:' or public_link_url ~* '^https?://[^/]+')),
  check (member_link_url !~ '[[:space:]\\]' and member_link_url !~ '^//' and (member_link_url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:' or member_link_url ~* '^https?://[^/]+'))
);
alter table public.round_announcements enable row level security;
revoke all on public.round_announcements from public, anon, authenticated;
grant select on public.round_announcements to anon, authenticated;
grant insert, update, delete on public.round_announcements to authenticated;
create policy "public reads enabled round announcements" on public.round_announcements
  for select to anon, authenticated using (enabled);
create policy "administrators manage round announcements" on public.round_announcements
  for all to authenticated using (public.is_current_admin()) with check (public.is_current_admin());

-- Reuse the existing public schedule reader and expose aggregate times only.
-- No new privileged function or private bidder fields are needed.
create or replace function public.read_round_announcement_schedule(requested_bid_year integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(bounds) order by round_number), '[]'::jsonb)
  from (
    select (w->>'round_number')::integer as round_number,
      min((w->>'opens_at')::timestamptz) as starts_at,
      max((w->>'closes_at')::timestamptz) as ends_at
    from jsonb_array_elements(public.read_public_bid_windows(requested_bid_year)) w
    group by (w->>'round_number')::integer
  ) bounds
$$;
revoke all on function public.read_round_announcement_schedule(integer) from public;
grant execute on function public.read_round_announcement_schedule(integer) to anon, authenticated;

-- Preserve the previously requested Round 2 announcement in the active year.
insert into public.round_announcements
  (bid_year, round_number, enabled, color, mode, title, body, public_link_label, public_link_url, member_link_label, member_link_url, starts_at, ends_at)
select y.bid_year, 2, true, 'amber', 'manual', 'Round {round} bidding starts {start}.',
  'Check your assigned bid time and review your selections.', 'Sign in to view your bid time', 'login',
  'View my bid window', 'bidding.html?page=dashboard', '2026-10-15 00:00 America/Los_Angeles'::timestamptz, '2026-10-17 00:00 America/Los_Angeles'::timestamptz
from public.bidding_site_settings s join public.bid_years y on y.id = s.active_bid_year_id
where s.singleton and y.bid_year = 2027
on conflict do nothing;
commit;
