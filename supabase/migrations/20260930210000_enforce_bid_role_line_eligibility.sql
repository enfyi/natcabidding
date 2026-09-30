-- Keep every bidder on the RDO line type assigned by the roster. GL is the
-- only cross-category exception; intake still reviews every GL selection.

create or replace function public.rdo_line_matches_bid_role(
  bidder_role text,
  area_name text,
  requested_line_type text,
  requested_pattern text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when bidder_role in ('ADM', 'NB') then false
    when bidder_role = 'GL' then requested_line_type in ('CPC', 'DEV')
    when area_name = 'TMU' and bidder_role = 'TMC' then requested_line_type = 'CPC'
    when area_name = 'TMU' and bidder_role = 'DEV' then requested_line_type = 'DEV'
    when area_name <> 'TMU' and bidder_role = 'CPC' then requested_line_type = 'CPC'
    when area_name <> 'TMU' and bidder_role = 'R-DEV' then requested_line_type = 'DEV' and requested_pattern = 'R-DEV'
    when area_name <> 'TMU' and bidder_role = 'D-DEV' then requested_line_type = 'DEV' and requested_pattern = 'D-DEV'
    else false
  end
$$;

revoke all on function public.rdo_line_matches_bid_role(text,text,text,text) from public, anon;
grant execute on function public.rdo_line_matches_bid_role(text,text,text,text) to authenticated;

-- Make the intake verification an API-level requirement as well as a visible
-- checkbox. Preserve extensions made to this reviewer by earlier migrations.
do $$
declare
  definition text;
  marker text := '    if decision = ''approved'' and not public.rdo_line_matches_bid_role(';
  verification_guard text := $guard$    if decision = 'approved' and target.bid_role = 'GL'
       and not coalesce((override_payload->>'glLineTypeVerified')::boolean, false) then
      raise exception 'Intake must verify whether this GL is bidding as CPC/TMC or DEV.';
    end if;

$guard$;
begin
  definition := pg_get_functiondef(
    'public.review_bidding_submission(uuid,text,text,jsonb)'::regprocedure
  );
  if position(marker in definition) = 0 then
    raise exception 'Could not install the GL line-type verification guard.';
  end if;
  if position('glLineTypeVerified' in definition) = 0 then
    definition := replace(definition, marker, verification_guard || marker);
    execute definition;
  end if;
end
$$;
