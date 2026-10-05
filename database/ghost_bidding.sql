-- Bid-year-specific ghost bidding support.
-- Install after schema.sql, then run/re-run transactional_bidding.sql and
-- high_priority_bidding_fixes.sql (when used), followed by
-- leave_submission_preflight.sql, rls_area_policies.sql, and
-- admin_bidder_editor.sql so their functions use the ghost-aware rules.

create schema if not exists private;

create table if not exists public.bidder_bid_year_settings (
  bid_year_id uuid not null references public.bid_years(id) on delete cascade,
  bidder_id uuid not null references public.bidders(id) on delete cascade,
  is_ghost_bidder boolean not null default false,
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bid_year_id, bidder_id)
);

create index if not exists bidder_bid_year_settings_bidder_idx
  on public.bidder_bid_year_settings(bidder_id);

create index if not exists bidder_bid_year_settings_updated_by_idx
  on public.bidder_bid_year_settings(updated_by)
  where updated_by is not null;

alter table public.leave_requests
  add column if not exists is_ghost_bid boolean not null default false;

alter table public.intake_submissions
  add column if not exists is_ghost_bid boolean not null default false;

alter table public.bidder_bid_year_settings enable row level security;

revoke all on table public.bidder_bid_year_settings from public, anon;
grant select on table public.bidder_bid_year_settings to authenticated;

drop policy if exists "users can read authorized ghost bidding settings"
  on public.bidder_bid_year_settings;
create policy "users can read authorized ghost bidding settings"
on public.bidder_bid_year_settings for select
to authenticated
using (
  bidder_id = (select b.id from public.bidders b where b.auth_user_id = (select auth.uid()) and b.active limit 1)
  or exists (
    select 1 from public.bidders actor
    where actor.auth_user_id = (select auth.uid())
      and actor.active
      and actor.role = 'admin'
  )
  or exists (
    select 1
    from public.bidders target
    where target.id = bidder_id
      and target.area_id = (
        select actor.area_id from public.bidders actor
        where actor.auth_user_id = (select auth.uid()) and actor.active limit 1
      )
      and exists (
        select 1 from public.bidders actor
        where actor.auth_user_id = (select auth.uid())
          and actor.active
          and (
            actor.role in ('admin', 'intake')
            or exists (
              select 1 from public.intake_schedules schedule
              where schedule.intake_user_id = actor.id
                and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
            )
          )
      )
  )
);

create or replace function public.is_ghost_bidder(
  target_bid_year_id uuid,
  target_bidder_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select settings.is_ghost_bidder
    from public.bidder_bid_year_settings settings
    where settings.bid_year_id = target_bid_year_id
      and settings.bidder_id = target_bidder_id
  ), false)
$$;

revoke all on function public.is_ghost_bidder(uuid, uuid) from public, anon, authenticated;

create or replace function public.effective_rdo_line_id(
  target_bid_year_id uuid,
  target_bidder_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select line.id
      from public.rdo_lines line
      where line.bid_year_id = target_bid_year_id
        and line.assigned_bidder_id = target_bidder_id
        and line.status = 'taken'
      order by line.updated_at desc, line.id
      limit 1
    ),
    (
      select submission.rdo_line_id
      from public.intake_submissions submission
      where submission.bid_year_id = target_bid_year_id
        and submission.bidder_id = target_bidder_id
        and submission.submission_type = 'rdo'
        and submission.is_ghost_bid
        and submission.status in ('pending', 'approved')
      order by submission.submitted_at desc nulls last, submission.created_at desc, submission.id
      limit 1
    )
  )
$$;

revoke all on function public.effective_rdo_line_id(uuid, uuid) from public, anon, authenticated;

create or replace function public.read_ghost_bidding_status(requested_bid_year integer)
returns table (bidder_id uuid, is_ghost_bidder boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select bidder.id, coalesce(settings.is_ghost_bidder, false)
  from public.bidders bidder
  join public.bid_years bid_year on bid_year.bid_year = requested_bid_year
  left join public.bidder_bid_year_settings settings
    on settings.bid_year_id = bid_year.id and settings.bidder_id = bidder.id
  where bidder.active
    and (
      bidder.auth_user_id = auth.uid()
      or exists (
        select 1 from public.bidders actor
        where actor.auth_user_id = auth.uid()
          and actor.active
          and (
            actor.role = 'admin'
            or (
              actor.area_id = bidder.area_id
              and (
                actor.role = 'intake'
                or exists (
                  select 1 from public.intake_schedules schedule
                  where schedule.intake_user_id = actor.id
                    and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
                )
              )
            )
          )
      )
    )
$$;

revoke all on function public.read_ghost_bidding_status(integer) from public, anon;
grant execute on function public.read_ghost_bidding_status(integer) to authenticated;

create or replace function public.set_ghost_bidding_status(
  requested_bid_year integer,
  target_bidder_id uuid,
  should_be_ghost boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.bidders%rowtype;
  target public.bidders%rowtype;
  target_bid_year_id uuid;
begin
  select * into actor
  from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
    and active;

  if actor.id is null or not (
    actor.role in ('admin', 'intake')
    or exists (
      select 1 from public.intake_schedules schedule
      where schedule.intake_user_id = actor.id
        and now() between schedule.starts_at - interval '60 minutes' and schedule.ends_at
    )
  ) then
    raise exception 'Bidding reviewer access is required.';
  end if;

  select * into strict target from public.bidders where id = target_bidder_id and active;
  if actor.role <> 'admin' and actor.area_id is distinct from target.area_id then
    raise exception 'This bidder is outside your authorized area.';
  end if;
  if target.bid_role in ('ADM', 'NB') then
    raise exception 'This profile cannot be designated as a ghost bidder.';
  end if;

  select id into strict target_bid_year_id
  from public.bid_years
  where bid_year = requested_bid_year;

  if exists (
    select 1
    from public.intake_submissions submission
    where submission.bid_year_id = target_bid_year_id
      and submission.bidder_id = target.id
      and submission.submission_type in ('rdo', 'leave')
      and submission.status in ('pending', 'approved')
      and submission.is_ghost_bid is distinct from coalesce(should_be_ghost, false)
  ) then
    raise exception 'Ghost bidding status must be set before the bidder submits RDO or leave bids.';
  end if;

  insert into public.bidder_bid_year_settings (
    bid_year_id, bidder_id, is_ghost_bidder, updated_by
  ) values (
    target_bid_year_id, target.id, coalesce(should_be_ghost, false), actor.id
  )
  on conflict (bid_year_id, bidder_id) do update
  set is_ghost_bidder = excluded.is_ghost_bidder,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.audit_events (
    bid_year_id, area_id, actor_id, event_type, entity_table, entity_id, details
  ) values (
    target_bid_year_id, target.area_id, actor.id, 'ghost_bidding_status_changed',
    'bidders', target.id, jsonb_build_object('is_ghost_bidder', coalesce(should_be_ghost, false))
  );

  return jsonb_build_object(
    'bidder_id', target.id,
    'is_ghost_bidder', coalesce(should_be_ghost, false)
  );
end
$$;

revoke all on function public.set_ghost_bidding_status(integer, uuid, boolean) from public, anon;
grant execute on function public.set_ghost_bidding_status(integer, uuid, boolean) to authenticated;

create or replace function private.recalculate_pending_leave_for_ghost_rdo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.submission_type <> 'rdo'
     or not new.is_ghost_bid
     or new.status not in ('pending', 'approved')
     or new.rdo_line_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.leave_requests request
    join public.leave_request_dates request_date on request_date.leave_request_id = request.id
    join public.rdo_line_days line_day
      on line_day.rdo_line_id = new.rdo_line_id
     and line_day.is_rdo
     and line_day.weekday = extract(dow from request_date.leave_date)::smallint
    where request.bid_year_id = new.bid_year_id
      and request.bidder_id = new.bidder_id
      and request.status in ('pending', 'approved')
      and request.round_number > 1
  ) then
    raise exception 'The Ghost Line change would place later-round leave on an RDO.';
  end if;

  update public.leave_request_dates request_date
  set is_rdo = exists (
        select 1
        from public.rdo_line_days line_day
        where line_day.rdo_line_id = new.rdo_line_id
          and line_day.is_rdo
          and line_day.weekday = extract(dow from request_date.leave_date)::smallint
      ),
      charged = not request_date.is_holiday
        and not request_date.is_holiday_in_lieu
        and not (
          request.round_number = 1
          and exists (
            select 1
            from public.rdo_line_days line_day
            where line_day.rdo_line_id = new.rdo_line_id
              and line_day.is_rdo
              and line_day.weekday = extract(dow from request_date.leave_date)::smallint
          )
        )
  from public.leave_requests request
  where request.id = request_date.leave_request_id
    and request.bid_year_id = new.bid_year_id
    and request.bidder_id = new.bidder_id
    and request.status in ('pending', 'approved');

  update public.leave_requests request
  set charged_days = (
        select count(*)::integer
        from public.leave_request_dates request_date
        where request_date.leave_request_id = request.id and request_date.charged
      ),
      is_ghost_bid = true,
      updated_at = now()
  where request.bid_year_id = new.bid_year_id
    and request.bidder_id = new.bidder_id
    and request.status in ('pending', 'approved');

  return new;
end
$$;

revoke all on function private.recalculate_pending_leave_for_ghost_rdo()
from public, anon, authenticated;

drop trigger if exists recalculate_pending_leave_for_ghost_rdo
on public.intake_submissions;
create trigger recalculate_pending_leave_for_ghost_rdo
after insert or update of rdo_line_id, status, is_ghost_bid
on public.intake_submissions
for each row
execute function private.recalculate_pending_leave_for_ghost_rdo();
