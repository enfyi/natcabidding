-- Enforce the personal Round 1 change window even when pilot rounds bypass
-- scheduled windows. Preserve authorized reviewer manual corrections.
do $upgrade$
declare
 definition text;
 marker text := '  select * into strict line_row';
 guard text := $guard$  -- RDO changes require the bidder's own two-hour Round 1 window.
  if not (manual_entry and actor.role in ('admin', 'intake'))
     and (exists (
       select 1 from public.intake_submissions s
       where s.bid_year_id = year_row.id and s.bidder_id = target.id
         and s.submission_type = 'rdo' and s.status = 'approved'
     ) or exists (
       select 1 from public.rdo_lines r
       where r.bid_year_id = year_row.id and r.assigned_bidder_id = target.id and r.status = 'taken'
     )) then
    if resolved_round is distinct from 1 or not exists (
      select 1 from public.bid_windows bw
      where bw.bid_year_id = year_row.id and bw.bidder_id = target.id and bw.round_number = 1
        and now() >= bw.opens_at
        and now() < least(bw.closes_at, bw.opens_at + interval '2 hours')
    ) then
      raise exception 'RDO changes are only allowed during your own two-hour Round 1 bid window.';
    end if;
  end if;

$guard$;
begin
 definition := pg_get_functiondef('public.submit_rdo_bid(integer,text,text,boolean,boolean,text,integer,text,text,boolean)'::regprocedure);
 if position('-- RDO changes require the bidder''s own two-hour Round 1 window.' in definition) > 0 then return; end if;
 if position(marker in definition) = 0 then raise exception 'Unrecognized RDO submission function.'; end if;
 execute replace(definition, marker, guard || marker);
end;
$upgrade$;
