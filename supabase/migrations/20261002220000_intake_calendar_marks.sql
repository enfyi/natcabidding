create table if not exists public.intake_calendar_marks (
  bid_year integer not null references public.bid_years(bid_year) on delete cascade,
  marked_date date not null,
  kind text not null check (kind in ('holiday', 'natca_validation', 'faa_validation')),
  primary key (bid_year, marked_date)
);

alter table public.intake_calendar_marks enable row level security;
revoke all on public.intake_calendar_marks from public, anon, authenticated;
grant select, insert, update, delete on public.intake_calendar_marks to authenticated;

create policy "Signed-in users can view intake calendar marks"
on public.intake_calendar_marks for select to authenticated
using (auth.uid() is not null);

create policy "Admins can add intake calendar marks"
on public.intake_calendar_marks for insert to authenticated
with check (auth.uid() is not null and (select public.is_current_admin()));

create policy "Admins can change intake calendar marks"
on public.intake_calendar_marks for update to authenticated
using (auth.uid() is not null and (select public.is_current_admin()))
with check (auth.uid() is not null and (select public.is_current_admin()));

create policy "Admins can clear intake calendar marks"
on public.intake_calendar_marks for delete to authenticated
using (auth.uid() is not null and (select public.is_current_admin()));
