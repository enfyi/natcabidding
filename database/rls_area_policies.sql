-- Area isolation rules for Supabase.
-- Regular logged-in users can only see or write data tied to their own area.
-- Supabase service-role/admin server actions can still manage all rows because service_role bypasses RLS.

create or replace function public.current_bidder_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from bidders b
  where b.auth_user_id = auth.uid()
    and b.active
  limit 1
$$;

create or replace function public.current_bidder_area_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.area_id
  from bidders b
  where b.auth_user_id = auth.uid()
    and b.active
  limit 1
$$;

create or replace function public.is_current_area(area_to_check uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select area_to_check is not null
    and area_to_check = public.current_bidder_area_id()
$$;

create or replace function public.is_bidder_in_current_area(bidder_to_check uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from bidders b
    where b.id = bidder_to_check
      and b.area_id = public.current_bidder_area_id()
  )
$$;

alter table areas enable row level security;
alter table bidders enable row level security;
alter table rdo_lines enable row level security;
alter table rdo_line_days enable row level security;
alter table bid_windows enable row level security;
alter table holiday_in_lieu_days enable row level security;
alter table leave_slots enable row level security;
alter table leave_requests enable row level security;
alter table leave_request_week_buckets enable row level security;
alter table leave_request_dates enable row level security;
alter table leave_credit_events enable row level security;
alter table intake_submissions enable row level security;
alter table intake_schedules enable row level security;
alter table help_threads enable row level security;
alter table help_messages enable row level security;
alter table audit_events enable row level security;

alter table bid_years enable row level security;
alter table bid_rounds enable row level security;
alter table holidays enable row level security;

drop policy if exists "authenticated can read bid years" on bid_years;
create policy "authenticated can read bid years"
on bid_years for select
to authenticated
using (true);

drop policy if exists "authenticated can read bid rounds" on bid_rounds;
create policy "authenticated can read bid rounds"
on bid_rounds for select
to authenticated
using (true);

drop policy if exists "authenticated can read holidays" on holidays;
create policy "authenticated can read holidays"
on holidays for select
to authenticated
using (true);

drop policy if exists "public can read bid years" on bid_years;
create policy "public can read bid years"
on bid_years for select
to anon
using (true);

drop policy if exists "public can read bid rounds" on bid_rounds;
create policy "public can read bid rounds"
on bid_rounds for select
to anon
using (true);

drop policy if exists "public can read holidays" on holidays;
create policy "public can read holidays"
on holidays for select
to anon
using (true);

drop policy if exists "public can read areas" on areas;
create policy "public can read areas"
on areas for select
to anon
using (true);

drop policy if exists "public can read rdo lines" on rdo_lines;
create policy "public can read rdo lines"
on rdo_lines for select
to anon
using (true);

drop policy if exists "public can read rdo line days" on rdo_line_days;
create policy "public can read rdo line days"
on rdo_line_days for select
to anon
using (true);

drop policy if exists "public can read leave slots" on leave_slots;
create policy "public can read leave slots"
on leave_slots for select
to anon
using (true);

drop policy if exists "users can read own area" on areas;
create policy "users can read own area"
on areas for select
to authenticated
using (true);

drop policy if exists "users can read bidders in own area" on bidders;
create policy "users can read bidders in own area"
on bidders for select
to authenticated
using (area_id = public.current_bidder_area_id());

drop policy if exists "users can read rdo lines in own area" on rdo_lines;
create policy "users can read rdo lines in own area"
on rdo_lines for select
to authenticated
using (true);

drop policy if exists "users can read rdo line days in own area" on rdo_line_days;
create policy "users can read rdo line days in own area"
on rdo_line_days for select
to authenticated
using (true);

drop policy if exists "users can read bid windows in own area" on bid_windows;
create policy "users can read bid windows in own area"
on bid_windows for select
to authenticated
using (public.is_bidder_in_current_area(bidder_id));

drop policy if exists "users can read holiday in lieu days in own area" on holiday_in_lieu_days;
create policy "users can read holiday in lieu days in own area"
on holiday_in_lieu_days for select
to authenticated
using (public.is_bidder_in_current_area(bidder_id));

drop policy if exists "users can read leave slots in own area" on leave_slots;
create policy "users can read leave slots in own area"
on leave_slots for select
to authenticated
using (true);

drop policy if exists "users can read leave requests in own area" on leave_requests;
create policy "users can read leave requests in own area"
on leave_requests for select
to authenticated
using (public.is_bidder_in_current_area(bidder_id));

drop policy if exists "users can read week buckets in own area" on leave_request_week_buckets;
create policy "users can read week buckets in own area"
on leave_request_week_buckets for select
to authenticated
using (
  exists (
    select 1
    from leave_requests lr
    where lr.id = leave_request_week_buckets.leave_request_id
      and public.is_bidder_in_current_area(lr.bidder_id)
  )
);

drop policy if exists "users can read leave dates in own area" on leave_request_dates;
create policy "users can read leave dates in own area"
on leave_request_dates for select
to authenticated
using (
  exists (
    select 1
    from leave_requests lr
    where lr.id = leave_request_dates.leave_request_id
      and public.is_bidder_in_current_area(lr.bidder_id)
  )
);

drop policy if exists "users can read leave credit events in own area" on leave_credit_events;
create policy "users can read leave credit events in own area"
on leave_credit_events for select
to authenticated
using (public.is_bidder_in_current_area(bidder_id));

drop policy if exists "users can read intake submissions in own area" on intake_submissions;
create policy "users can read intake submissions in own area"
on intake_submissions for select
to authenticated
using (
  area_id = public.current_bidder_area_id()
  or public.is_bidder_in_current_area(bidder_id)
);

drop policy if exists "users can read intake schedules in own area" on intake_schedules;
create policy "users can read intake schedules in own area"
on intake_schedules for select
to authenticated
using (
  area_id = public.current_bidder_area_id()
  or public.is_bidder_in_current_area(intake_user_id)
);

drop policy if exists "users can read help threads in own area" on help_threads;
create policy "users can read help threads in own area"
on help_threads for select
to authenticated
using (public.is_bidder_in_current_area(bidder_id));

drop policy if exists "users can read help messages in own area" on help_messages;
create policy "users can read help messages in own area"
on help_messages for select
to authenticated
using (
  exists (
    select 1
    from help_threads ht
    where ht.id = help_messages.thread_id
      and public.is_bidder_in_current_area(ht.bidder_id)
  )
);

drop policy if exists "users can read audit events in own area" on audit_events;
create policy "users can read audit events in own area"
on audit_events for select
to authenticated
using (
  area_id = public.current_bidder_area_id()
  or public.is_bidder_in_current_area(actor_id)
);

drop policy if exists "users can create own-area leave requests" on leave_requests;
create policy "users can create own-area leave requests"
on leave_requests for insert
to authenticated
with check (bidder_id = public.current_bidder_id());

drop policy if exists "users can update own leave requests before approval" on leave_requests;
create policy "users can update own leave requests before approval"
on leave_requests for update
to authenticated
using (bidder_id = public.current_bidder_id() and status in ('draft', 'preview', 'pending'))
with check (bidder_id = public.current_bidder_id());

drop policy if exists "users can create own-area leave request dates" on leave_request_dates;
create policy "users can create own-area leave request dates"
on leave_request_dates for insert
to authenticated
with check (
  exists (
    select 1
    from leave_requests lr
    where lr.id = leave_request_dates.leave_request_id
      and lr.bidder_id = public.current_bidder_id()
  )
);

drop policy if exists "users can create own-area week buckets" on leave_request_week_buckets;
create policy "users can create own-area week buckets"
on leave_request_week_buckets for insert
to authenticated
with check (
  exists (
    select 1
    from leave_requests lr
    where lr.id = leave_request_week_buckets.leave_request_id
      and lr.bidder_id = public.current_bidder_id()
  )
);

drop policy if exists "users can create own intake submissions" on intake_submissions;
create policy "users can create own intake submissions"
on intake_submissions for insert
to authenticated
with check (
  bidder_id = public.current_bidder_id()
  and (area_id is null or area_id = public.current_bidder_area_id())
);
