-- Reuse immutable admin-editor audit snapshots, including edits made before
-- this migration. Keep the existing reader's authorization and row scope.
begin;
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.read_bidding_state(integer)'::regprocedure) into definition;
  if position('''adminEditHistory''' in definition) > 0 then return; end if;
  updated_definition := replace(definition, '''payload'', s.payload', $replacement$
    'payload', s.payload,
    'adminEditHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id, 'editedAt', event.created_at,
        'editedBy', coalesce(editor.initials, 'Former intake/admin'),
        'before', event.details->'before'->'rdo'->'payload',
        'after', event.details->'after'->'rdo'->'payload'
      ) order by event.created_at desc, event.id)
      from public.audit_events event
      left join public.bidders editor on editor.id = event.actor_id
      where event.event_type = 'bidder_bids_edited'
        and event.entity_table = 'bidders'
        and event.entity_id = s.bidder_id
        and event.bid_year_id = s.bid_year_id
        and event.details->'after'->'rdo'->>'id' = s.id::text
    ), '[]'::jsonb)
  $replacement$);
  if updated_definition = definition then
    raise exception 'The intake reader payload marker was not found; authorization was left unchanged.';
  end if;
  execute updated_definition;
end;
$migration$;
commit;
