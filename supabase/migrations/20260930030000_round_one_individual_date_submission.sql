-- Upgrade legacy Round 1 submission checks without replacing installed pilot,
-- capacity, allowance, or authorization rules. Count dates, not request rows.
create or replace function private.round_one_week_bucket_starts(bid_dates date[])
returns date[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  selected_date date;
  current_start date;
  starts date[] := array[]::date[];
begin
  for selected_date in
    select distinct day from unnest(coalesce(bid_dates, array[]::date[])) as days(day)
    where day is not null order by day
  loop
    if current_start is null or selected_date > current_start + 6 then
      current_start := selected_date;
      starts := array_append(starts, current_start);
    end if;
  end loop;
  return starts;
end;
$function$;

revoke all on function private.round_one_week_bucket_starts(date[]) from public, anon, authenticated;

do $upgrade$
declare
  definition text;
  original_block text;
  replacement_block text;
begin
  definition := pg_get_functiondef(to_regprocedure('public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)'));
  if definition is null then raise exception 'Required public leave submitter is missing.'; end if;
  if position('This batch would bring you to %s.' in definition) > 0
     and position('into requested_week_count' in definition) > 0 then
    original_block := substring(definition from '  if batch_round = 1 then[\s\S]*?  else
    round_leave_limit :=');
    if original_block is null then raise exception 'Unrecognized Round 1 preflight check.'; end if;
    replacement_block := $block$  if batch_round = 1 then
    select cardinality(private.round_one_week_bucket_starts(array_agg(d.leave_date)))
    into requested_week_count
    from (
      select gs::date as leave_date
      from jsonb_array_elements(requested_items) requested(item)
      cross join lateral generate_series(
        (requested.item ->> 'start_date')::date,
        (requested.item ->> 'end_date')::date, interval '1 day'
      ) gs
      union
      select rd.leave_date
      from public.leave_request_dates rd
      join public.leave_requests lr on lr.id = rd.leave_request_id
      where lr.bid_year_id = year_row.id and lr.bidder_id = target.id
        and lr.round_number = 1 and lr.status in ('pending', 'approved')
    ) d;
    if requested_week_count > 2 then
      error_messages := array_append(error_messages, format(
        'Round 1 can include no more than 2 bid weeks. This batch would bring you to %s.',
        requested_week_count
      ));
    end if;
  else
    round_leave_limit :=$block$;
    execute replace(definition, original_block, replacement_block);
  end if;

  definition := pg_get_functiondef(to_regprocedure('private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)'));
  if definition is null then raise exception 'Required private leave submitter is missing.'; end if;
  if position('foreach leave_date in array all_dates loop' in definition) > 0 then
    original_block := substring(definition from '    select coalesce\(array_agg\(distinct wb.bucket_start_date[\s\S]*?    if cardinality\(bucket_starts\) > 2 then');
    if original_block is null then raise exception 'Unrecognized Round 1 private check.'; end if;
    replacement_block := $block$    select private.round_one_week_bucket_starts(array_agg(d.leave_date))
    into bucket_starts
    from (
      select unnest(all_dates) as leave_date
      union
      select rd.leave_date
      from public.leave_request_dates rd
      join public.leave_requests lr on lr.id = rd.leave_request_id
      where lr.bid_year_id = year_row.id and lr.bidder_id = target.id
        and lr.round_number = 1 and lr.status in ('pending', 'approved')
    ) d;
    if cardinality(bucket_starts) > 2 then$block$;
    execute replace(definition, original_block, replacement_block);
  end if;
end;
$upgrade$;
