-- The compatibility migration can already have been recorded on a database
-- whose legacy submitter still needs its Round 4 holiday-credit calculation.
-- Re-run the idempotent rewrite with exact block boundaries.

do $block$
declare
  function_definition text;
  old_credit_block constant text := $old$if batch_round >= 4 then
    select coalesce(sum(credit.credit_days), 0)::integer
    into available_credit_days
    from public.leave_credit_events credit
    where credit.bid_year_id = year_row.id
      and credit.bidder_id = target.id
      and credit.round_number <= batch_round;
  end if;$old$;
  new_credit_block constant text := $new$if batch_round >= 4 then
    available_credit_days := private.round_four_credit_days(year_row.id, target.id);
  end if;$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)'::regprocedure
  )
  into function_definition;

  if pg_catalog.strpos(function_definition, old_credit_block) > 0 then
    execute pg_catalog.replace(function_definition, old_credit_block, new_credit_block);
  end if;
end
$block$;
