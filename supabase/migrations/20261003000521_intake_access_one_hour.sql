-- Extend scheduled Intake access without changing unrelated bid-window timing.
-- Only these existing authorization routines may be updated.
do $migration$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('private', 'replace_approved_leave_request_dates_unchecked'),
      ('private', 'replace_bidder_editor_leave_dates'),
      ('private', 'bidder_editor_actor'),
      ('public', 'read_ghost_bidding_status'),
      ('public', 'set_ghost_bidding_status')
    )
  loop
    definition := pg_get_functiondef(routine.oid);
    if definition like '%starts_at - interval ''15 minutes''%' then
      execute replace(
        definition,
        'starts_at - interval ''15 minutes''',
        'starts_at - interval ''60 minutes'''
      );
    end if;
  end loop;
end;
$migration$;

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
