-- Developmental bidders do not work AWS or Mid. Normalize every RDO write
-- path so member bids, intake entry, overrides, and older clients agree.

create or replace function public.enforce_rdo_submission_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.bidders%rowtype;
  requested_line public.rdo_lines%rowtype;
  target_area_name text;
begin
  if new.submission_type <> 'rdo' or new.rdo_line_id is null then return new; end if;
  select * into strict target from public.bidders where id = new.bidder_id;
  select * into strict requested_line from public.rdo_lines where id = new.rdo_line_id;
  select area.name into strict target_area_name from public.areas area where area.id = target.area_id;

  if requested_line.area_id is distinct from target.area_id
     or not public.rdo_line_matches_bid_role(
       target.bid_role, target_area_name, requested_line.line_type, requested_line.pattern
     ) then
    raise exception 'RDO line % is not eligible for the bidder''s % role.', requested_line.line_code, target.bid_role;
  end if;

  if target.bid_role in ('R-DEV', 'D-DEV', 'DEV') then
    new.payload := new.payload || jsonb_build_object('aws', false, 'mid', 'No');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_rdo_submission_eligibility() from public, anon, authenticated;

create or replace function public.enforce_rdo_assignment_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.bidders%rowtype;
  target_area_name text;
begin
  if new.assigned_bidder_id is null then return new; end if;
  select * into strict target from public.bidders where id = new.assigned_bidder_id;
  if target.bid_role = 'GL' then
    raise exception 'GL bids do not populate RDO line assignments.';
  end if;
  select area.name into strict target_area_name from public.areas area where area.id = target.area_id;
  if new.area_id is distinct from target.area_id
     or not public.rdo_line_matches_bid_role(
       target.bid_role, target_area_name, new.line_type, new.pattern
     ) then
    raise exception 'RDO line % is not eligible for the bidder''s % role.', new.line_code, target.bid_role;
  end if;

  if target.bid_role in ('R-DEV', 'D-DEV', 'DEV') then
    new.aws := false;
    new.mid := 'No';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_rdo_assignment_eligibility() from public, anon, authenticated;

-- Bring previously saved DEV bids and current DEV assignments under the same
-- rule immediately instead of waiting for each record to be edited again.
update public.intake_submissions submission
set payload = submission.payload || jsonb_build_object('aws', false, 'mid', 'No'),
    updated_at = now()
from public.bidders bidder
where bidder.id = submission.bidder_id
  and submission.submission_type = 'rdo'
  and bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV')
  and (
    submission.payload->>'aws' is distinct from 'false'
    or submission.payload->>'mid' is distinct from 'No'
  );

update public.rdo_lines line
set aws = false,
    mid = 'No',
    updated_at = now()
from public.bidders bidder
where bidder.id = line.assigned_bidder_id
  and bidder.bid_role in ('R-DEV', 'D-DEV', 'DEV')
  and (line.aws is distinct from false or line.mid is distinct from 'No');
