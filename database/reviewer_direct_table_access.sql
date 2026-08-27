-- Direct Data API writes for active admin/intake reviewers only.
-- Regular bidders continue to submit through the transactional RPC functions.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;

create or replace function private.is_current_bidding_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.bidders b
      where b.auth_user_id = (select auth.uid())
        and lower(b.email) = lower((select auth.jwt() ->> 'email'))
        and b.role in ('admin', 'intake')
        and b.active
    )
$$;

revoke all on function private.is_current_bidding_reviewer() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_current_bidding_reviewer() to authenticated;

-- These policies predate the transactional RPC write path. Leaving them in place
-- while restoring table grants would also restore direct controller writes.
drop policy if exists "users can create own intake submissions" on public.intake_submissions;
drop policy if exists "users can create own-area leave requests" on public.leave_requests;
drop policy if exists "users can update own leave requests before approval" on public.leave_requests;
drop policy if exists "users can create own-area leave request dates" on public.leave_request_dates;
drop policy if exists "users can create own-area week buckets" on public.leave_request_week_buckets;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'bid_rounds',
    'bid_windows',
    'rdo_lines',
    'rdo_line_days',
    'holiday_in_lieu_days',
    'leave_slots',
    'leave_requests',
    'leave_request_dates',
    'leave_request_week_buckets',
    'intake_submissions'
  ]
  loop
    execute format('alter table public.%I enable row level security', target_table);

    execute format('drop policy if exists %I on public.%I', 'reviewers can select ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_current_bidding_reviewer()))',
      'reviewers can select ' || target_table,
      target_table
    );

    execute format('drop policy if exists %I on public.%I', 'reviewers can insert ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_current_bidding_reviewer()))',
      'reviewers can insert ' || target_table,
      target_table
    );

    execute format('drop policy if exists %I on public.%I', 'reviewers can update ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_current_bidding_reviewer())) with check ((select private.is_current_bidding_reviewer()))',
      'reviewers can update ' || target_table,
      target_table
    );

    execute format('drop policy if exists %I on public.%I', 'reviewers can delete ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_current_bidding_reviewer()))',
      'reviewers can delete ' || target_table,
      target_table
    );
  end loop;

  foreach target_table in array array['leave_credit_events', 'audit_events']
  loop
    execute format('alter table public.%I enable row level security', target_table);

    execute format('drop policy if exists %I on public.%I', 'reviewers can select ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_current_bidding_reviewer()))',
      'reviewers can select ' || target_table,
      target_table
    );

    execute format('drop policy if exists %I on public.%I', 'reviewers can insert ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_current_bidding_reviewer()))',
      'reviewers can insert ' || target_table,
      target_table
    );

    execute format('drop policy if exists %I on public.%I', 'reviewers can update ' || target_table, target_table);
    execute format('drop policy if exists %I on public.%I', 'reviewers can delete ' || target_table, target_table);
  end loop;
end
$$;

revoke insert, update, delete on
  public.bid_rounds,
  public.bid_windows,
  public.rdo_lines,
  public.rdo_line_days,
  public.holiday_in_lieu_days,
  public.leave_slots,
  public.leave_requests,
  public.leave_request_dates,
  public.leave_request_week_buckets,
  public.leave_credit_events,
  public.intake_submissions,
  public.audit_events
from anon, authenticated;

grant select, insert, update, delete on
  public.bid_rounds,
  public.bid_windows,
  public.rdo_lines,
  public.rdo_line_days,
  public.holiday_in_lieu_days,
  public.leave_slots,
  public.leave_requests,
  public.leave_request_dates,
  public.leave_request_week_buckets,
  public.intake_submissions
to authenticated;

grant select, insert on
  public.leave_credit_events,
  public.audit_events
to authenticated;

commit;
