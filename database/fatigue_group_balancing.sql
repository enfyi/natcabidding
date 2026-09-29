begin;

create schema if not exists private;

create or replace function private.rdo_line_fatigue_set(requested_line_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when line.line_type = 'CPC' then upper(trim(line.pattern))
    else coalesce(
      (
        select string_agg(day.weekday::text, '/' order by day.weekday)
        from public.rdo_line_days day
        where day.rdo_line_id = line.id
          and upper(trim(day.shift_code)) = 'RDO'
      ),
      upper(trim(line.pattern))
    )
  end
  from public.rdo_lines line
  where line.id = requested_line_id;
$$;

create or replace function private.fatigue_group_is_available(
  requested_bid_year_id uuid,
  requested_area_id uuid,
  requested_line_id uuid,
  requested_group text,
  excluded_bidder_id uuid default null
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  line_row public.rdo_lines%rowtype;
  pool_type text;
  rdo_set text;
  area_total integer;
  rdo_total integer;
  area_base integer;
  rdo_base integer;
  area_remainder integer;
  rdo_remainder integer;
  area_used integer;
  rdo_used integer;
  area_extra_groups integer;
  rdo_extra_groups integer;
begin
  if requested_group not in ('A', 'B', 'C') then return false; end if;

  select * into strict line_row
  from public.rdo_lines line
  where line.id = requested_line_id
    and line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id;

  pool_type := case when line_row.line_type = 'CPC' then 'CPC' else 'DEV' end;
  rdo_set := private.rdo_line_fatigue_set(line_row.id);

  select count(*) into area_total
  from public.bidders bidder
  where bidder.area_id = requested_area_id
    and bidder.active
    and case
      when pool_type = 'CPC' then bidder.bid_role in ('CPC', 'TMC')
      else bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV')
    end;

  if area_total = 0 then
    select count(*) into area_total
    from public.rdo_lines line
    where line.bid_year_id = requested_bid_year_id
      and line.area_id = requested_area_id
      and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end;
  end if;

  select count(*) into rdo_total
  from public.rdo_lines line
  where line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id
    and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
    and private.rdo_line_fatigue_set(line.id) = rdo_set;

  area_base := floor(area_total::numeric / 3)::integer;
  rdo_base := floor(rdo_total::numeric / 3)::integer;
  area_remainder := mod(area_total, 3);
  rdo_remainder := mod(rdo_total, 3);

  select count(*) into area_used
  from public.rdo_lines line
  where line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id
    and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
    and line.status = 'taken'
    and line.fatigue_group = requested_group
    and line.assigned_bidder_id is distinct from excluded_bidder_id;

  select count(*) into rdo_used
  from public.rdo_lines line
  where line.bid_year_id = requested_bid_year_id
    and line.area_id = requested_area_id
    and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
    and private.rdo_line_fatigue_set(line.id) = rdo_set
    and line.status = 'taken'
    and line.fatigue_group = requested_group
    and line.assigned_bidder_id is distinct from excluded_bidder_id;

  select count(*) into area_extra_groups
  from (
    select line.fatigue_group
    from public.rdo_lines line
    where line.bid_year_id = requested_bid_year_id
      and line.area_id = requested_area_id
      and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
      and line.status = 'taken'
      and line.fatigue_group in ('A', 'B', 'C')
      and line.assigned_bidder_id is distinct from excluded_bidder_id
    group by line.fatigue_group
    having count(*) > area_base
  ) claimed;

  select count(*) into rdo_extra_groups
  from (
    select line.fatigue_group
    from public.rdo_lines line
    where line.bid_year_id = requested_bid_year_id
      and line.area_id = requested_area_id
      and case when pool_type = 'CPC' then line.line_type = 'CPC' else line.line_type <> 'CPC' end
      and private.rdo_line_fatigue_set(line.id) = rdo_set
      and line.status = 'taken'
      and line.fatigue_group in ('A', 'B', 'C')
      and line.assigned_bidder_id is distinct from excluded_bidder_id
    group by line.fatigue_group
    having count(*) > rdo_base
  ) claimed;

  return
    area_used < area_base + case when area_remainder > 0 then 1 else 0 end
    and rdo_used < rdo_base + case when rdo_remainder > 0 then 1 else 0 end
    and not (area_used >= area_base and area_extra_groups >= area_remainder)
    and not (rdo_used >= rdo_base and rdo_extra_groups >= rdo_remainder);
end;
$$;

revoke all on function private.rdo_line_fatigue_set(uuid) from public, anon, authenticated;
revoke all on function private.fatigue_group_is_available(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

commit;
