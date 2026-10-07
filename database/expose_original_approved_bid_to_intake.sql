-- Expose the stored original bid without replacing intake authorization.
begin;
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.read_bidding_state(integer)'::regprocedure)
  into definition;
  if position('''originalBid'', s.original_bid' in definition) > 0 then
    return;
  end if;
  updated_definition := replace(definition,
    '''payload'', s.payload',
    '''payload'', s.payload, ''bidderId'', s.bidder_id, ''isChange'', s.is_change, ''originalBid'', s.original_bid, ''supersedesSubmissionId'', s.supersedes_submission_id, ''changeSource'', s.change_source');
  if updated_definition = definition then
    raise exception 'The intake reader payload marker was not found; authorization was left unchanged.';
  end if;
  execute updated_definition;
end;
$migration$;
commit;
