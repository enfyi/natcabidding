-- Existing production eligibility/holiday routines, copied read-only for local tests.
CREATE OR REPLACE FUNCTION public.rdo_line_matches_bid_role(bidder_role text, area_name text, requested_line_type text, requested_pattern text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when area_name = 'TMU' then
      bidder_role in ('TMC', 'TMCIT', 'GL') and requested_line_type = 'CPC'
    when bidder_role in ('CPC', 'GL') then requested_line_type = 'CPC'
    when bidder_role = 'R-DEV' then requested_line_type = 'DEV' and requested_pattern = 'R-DEV'
    when bidder_role = 'D-DEV' then requested_line_type = 'DEV' and requested_pattern = 'D-DEV'
    else false
  end
$function$

CREATE OR REPLACE FUNCTION public.refresh_bidder_holiday_in_lieu(target_bid_year_id uuid, target_bidder_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line_id uuid;
  holiday_row record;
  first_rdo smallint;
  direction integer;
  candidate date;
begin
  delete from public.holiday_in_lieu_days
  where bid_year_id = target_bid_year_id and bidder_id = target_bidder_id;

  select rl.id into line_id
  from public.rdo_lines rl
  where rl.bid_year_id = target_bid_year_id
    and rl.assigned_bidder_id = target_bidder_id
    and rl.status = 'taken'
  limit 1;

  if line_id is null then return; end if;

  select min(rld.weekday) into first_rdo
  from public.rdo_line_days rld
  where rld.rdo_line_id = line_id and rld.is_rdo;

  for holiday_row in
    select h.*
    from public.holidays h
    where h.bid_year_id = target_bid_year_id
    order by h.holiday_date, h.id
  loop
    if not exists (
      select 1 from public.rdo_line_days rld
      where rld.rdo_line_id = line_id
        and rld.is_rdo
        and rld.weekday = extract(dow from holiday_row.holiday_date)::smallint
    ) then
      continue;
    end if;

    direction := case when extract(dow from holiday_row.holiday_date)::smallint = first_rdo then 1 else -1 end;
    candidate := holiday_row.holiday_date + direction;

    while exists (
      select 1 from public.rdo_line_days rld
      where rld.rdo_line_id = line_id and rld.is_rdo
        and rld.weekday = extract(dow from candidate)::smallint
    ) or exists (
      select 1 from public.holidays h
      where h.bid_year_id = target_bid_year_id and h.holiday_date = candidate
    ) or exists (
      select 1 from public.holiday_in_lieu_days hil
      where hil.bid_year_id = target_bid_year_id
        and hil.bidder_id = target_bidder_id
        and hil.in_lieu_date = candidate
    ) loop
      candidate := candidate + direction;
    end loop;

    insert into public.holiday_in_lieu_days (
      bid_year_id, bidder_id, holiday_id, in_lieu_date, source_rdo_line_id
    ) values (
      target_bid_year_id, target_bidder_id, holiday_row.id, candidate, line_id
    );
  end loop;
end
$function$
