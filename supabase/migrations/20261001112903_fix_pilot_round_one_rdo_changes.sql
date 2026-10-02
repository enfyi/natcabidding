-- Match RDO changes to the existing authorized pilot round policy. Production
-- still requires the bidder's personal Round 1 window with a two-hour cap.
do $upgrade$
declare
  definition text;
  original_check text := 'if resolved_round is distinct from 1 or not exists (';
  replacement_check text := 'if resolved_round is distinct from 1 or (
      not private.pilot_round_bypasses_window(year_row.id, resolved_round)
      and not exists (';
  original_end text := 'now() < least(bw.closes_at, bw.opens_at + interval ''2 hours'')
    ) then';
  replacement_end text := 'now() < least(bw.closes_at, bw.opens_at + interval ''2 hours'')
    )) then';
begin
  definition := pg_get_functiondef('public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)'::regprocedure);
  if position(replacement_check in definition) > 0 then return; end if;
  if position(original_check in definition) = 0 or position(original_end in definition) = 0 then
    raise exception 'Unrecognized RDO change window guard.';
  end if;
  execute replace(replace(definition, original_check, replacement_check), original_end, replacement_end);
end;
$upgrade$;
