-- Preserve installed result schemas, submitter fields, and authorization rules.
-- Only hoist checks whose result is constant for this actor/year/snapshot.
do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.read_bidding_state(integer)'::regprocedure);
  if position('dashboard_can_review boolean' in definition) = 0 then
    if position('year_id uuid;' in definition) = 0
      or position('private.can_review_intake_year(year_id)' in definition) = 0
      or position('select jsonb_build_object(' in definition) = 0 then
      raise exception 'Unrecognized bidding-state reader; refusing to change authorization.';
    end if;
    definition := replace(definition, 'year_id uuid;', 'year_id uuid; dashboard_can_review boolean;');
    definition := replace(definition, 'private.can_review_intake_year(year_id)', 'dashboard_can_review');
    definition := replace(definition, 'select jsonb_build_object(',
      'dashboard_can_review := private.can_review_intake_year(year_id);
  select jsonb_build_object(');
    execute definition;
  end if;

  definition := pg_get_functiondef('public.read_leave_intake_queue(integer)'::regprocedure);
  if position('dashboard_queue_access as materialized' in definition) = 0 then
    if position('with ranked_bidders as (' in definition) = 0
      or position('join bid_years byear on byear.id = lr.bid_year_id' in definition) = 0
      or position('private.can_review_intake_year(lr.bid_year_id)' in definition) = 0
      or position('public.current_bidder_area_id()' in definition) = 0 then
      raise exception 'Unrecognized leave reader; refusing to change authorization.';
    end if;
    definition := replace(definition, 'with ranked_bidders as (',
      'with dashboard_queue_access as materialized (
    select byear.id, byear.bid_year,
      private.can_review_intake_year(byear.id) as can_review,
      (select public.current_bidder_area_id()) as actor_area_id
    from public.bid_years byear
    where queue_bid_year is null or byear.bid_year = queue_bid_year
  ), ranked_bidders as (');
    definition := replace(definition,
      'join bid_years byear on byear.id = lr.bid_year_id',
      'join dashboard_queue_access byear on byear.id = lr.bid_year_id');
    definition := replace(definition, 'private.can_review_intake_year(lr.bid_year_id)', 'byear.can_review');
    -- Replace only the existing row predicate, not the new initplan above.
    definition := replace(definition, 'b.area_id = public.current_bidder_area_id()', 'b.area_id = byear.actor_area_id');
    execute definition;
  end if;
end;
$migration$;

-- The internal definer reads buckets ONLY for rows authorized by the existing
-- queue RPC. The public entry point uses invoker security and an explicit gate.
create or replace function private.read_leave_intake_queue_with_weeks(queue_bid_year integer)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    to_jsonb(queue) || jsonb_build_object('weekBucketStarts', coalesce((
      select jsonb_agg(bucket.bucket_start_date order by bucket.bucket_start_date)
      from public.leave_request_week_buckets bucket
      where bucket.leave_request_id = queue.id
        and queue.round_number = 1 and queue.status in ('pending', 'approved')
    ), '[]'::jsonb)) order by queue.created_at desc, queue.id
  ), '[]'::jsonb)
  from public.read_leave_intake_queue(queue_bid_year) queue
  where (select auth.uid()) is not null;
$$;
revoke all on function private.read_leave_intake_queue_with_weeks(integer) from public, anon;
grant execute on function private.read_leave_intake_queue_with_weeks(integer) to authenticated;

create or replace function public.read_leave_intake_queue_with_weeks(queue_bid_year integer default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  return private.read_leave_intake_queue_with_weeks(queue_bid_year);
end;
$$;
revoke all on function public.read_leave_intake_queue_with_weeks(integer) from public, anon;
grant execute on function public.read_leave_intake_queue_with_weeks(integer) to authenticated;
