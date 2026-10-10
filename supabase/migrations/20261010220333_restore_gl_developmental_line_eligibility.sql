-- GL may select CPC or DEV lines; preserve all other active role restrictions.
create or replace function public.rdo_line_matches_bid_role(bidder_role text, area_name text, requested_line_type text, requested_pattern text)
returns boolean language sql immutable security invoker set search_path = ''
as $function$
  select case
    when bidder_role = 'GL' then requested_line_type in ('CPC', 'DEV')
    when area_name = 'TMU' then
      bidder_role in ('TMC', 'TMCIT') and requested_line_type = 'CPC'
    when bidder_role = 'CPC' then requested_line_type = 'CPC'
    when bidder_role = 'R-DEV' then requested_line_type = 'DEV' and requested_pattern = 'R-DEV'
    when bidder_role = 'D-DEV' then requested_line_type = 'DEV' and requested_pattern = 'D-DEV'
    else false
  end
$function$;

