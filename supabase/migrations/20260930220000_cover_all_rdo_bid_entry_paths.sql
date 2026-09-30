-- Reinstall the shared RDO eligibility backstops so every write path uses the
-- same rule: member bids, intake manual entry, pending edits, admin editing,
-- review overrides, and direct table writes.

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
  return new;
end
$$;

revoke all on function public.enforce_rdo_submission_eligibility() from public, anon, authenticated;

drop trigger if exists intake_submissions_enforce_rdo_eligibility on public.intake_submissions;
create trigger intake_submissions_enforce_rdo_eligibility
before insert or update of bidder_id, rdo_line_id, submission_type
on public.intake_submissions
for each row execute function public.enforce_rdo_submission_eligibility();

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
  return new;
end
$$;

revoke all on function public.enforce_rdo_assignment_eligibility() from public, anon, authenticated;

drop trigger if exists rdo_lines_enforce_assignment_eligibility on public.rdo_lines;
create trigger rdo_lines_enforce_assignment_eligibility
before insert or update of area_id, line_type, pattern, assigned_bidder_id
on public.rdo_lines
for each row execute function public.enforce_rdo_assignment_eligibility();

-- The full-record bidder editor is another intake input surface. Keep its
-- dry-run and save behavior, while requiring the same explicit GL attestation.
do $upgrade$
declare
  definition text;
  editor_signature regprocedure := to_regprocedure('private.save_bidder_editor(integer,uuid,jsonb,jsonb)');
  marker text := '  line_change := changes->''rdo'';';
  guard text := $guard$
  if target.bid_role = 'GL' and line_change is not null and line_change <> 'null'::jsonb
     and not coalesce((line_change->>'gl_line_type_verified')::boolean,false) then
    raise exception 'Verify whether this GL is bidding as CPC/TMC or DEV.';
  end if;$guard$;
begin
  if editor_signature is null then return; end if;
  definition := pg_catalog.pg_get_functiondef(editor_signature);
  if position('gl_line_type_verified' in definition) = 0 then
    if position(marker in definition) = 0 then
      raise exception 'Could not install the bidder-editor GL verification guard.';
    end if;
    definition := replace(definition, marker, marker || guard);
    execute definition;
  end if;
end
$upgrade$;
