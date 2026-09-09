-- Shared RDO line eligibility rules for member and admin bidding flows.

create or replace function public.rdo_line_matches_bid_role(
  bidder_role text,
  area_name text,
  requested_line_type text,
  requested_pattern text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when area_name = 'TMU' then
      (bidder_role in ('TMC', 'GL') and requested_line_type = 'CPC')
      or (bidder_role = 'DEV' and requested_line_type = 'DEV')
    when bidder_role = 'ADM' then false
    when bidder_role in ('CPC', 'GL') then requested_line_type = 'CPC'
    when bidder_role = 'R-DEV' then requested_line_type = 'DEV' and requested_pattern = 'R-DEV'
    when bidder_role = 'D-DEV' then requested_line_type = 'DEV' and requested_pattern = 'D-DEV'
    else false
  end
$function$;

grant execute on function public.rdo_line_matches_bid_role(text, text, text, text)
  to anon, authenticated;
