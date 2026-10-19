begin;
do $test$
declare
  actor public.bidders%rowtype;
  submission public.intake_submissions%rowtype;
  snapshot jsonb; draft jsonb; result jsonb; bid_year integer;
begin
  select * into strict actor from public.bidders where role='admin' and active and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  select s.* into strict submission from public.intake_submissions s
    join public.bidders b on b.id=s.bidder_id
    where s.submission_type='rdo' and s.status='approved' and b.active and b.bid_role='CPC'
    order by s.submitted_at desc limit 1;
  select y.bid_year into bid_year from public.bid_years y where y.id=submission.bid_year_id;
  snapshot := private.bidder_editor_snapshot(submission.bid_year_id,submission.bidder_id);
  draft := jsonb_build_object('rdo',jsonb_build_object(
    'line_id',snapshot->'rdo'->>'rdo_line_id','fatigue_group','',
    'flex',coalesce((snapshot->'assignment'->>'flex')::boolean,false),
    'aws',coalesce((snapshot->'assignment'->>'aws')::boolean,false),
    'mid',coalesce(snapshot->'assignment'->>'mid','No')),
    'leave',coalesce((select jsonb_agg(jsonb_build_object('id',v->>'id','start_date',v->>'requested_start_date','end_date',v->>'requested_end_date')) from jsonb_array_elements(snapshot->'leave') v),'[]'::jsonb));
  result := public.edit_admin_bidder(bid_year,submission.bidder_id,snapshot,draft,true);
  if not coalesce((result->>'valid')::boolean,false) then raise exception 'No preference validation failed: %',result; end if;
  draft := jsonb_set(draft,'{rdo,fatigue_group}','"Z"');
  result := public.edit_admin_bidder(bid_year,submission.bidder_id,snapshot,draft,true);
  if coalesce((result->>'valid')::boolean,false) or result->>'errors' not like '%Choose fatigue group%' then
    raise exception 'Invalid group was not rejected: %',result;
  end if;
  draft := jsonb_set(draft,'{rdo,fatigue_group}','null');
  result := public.edit_admin_bidder(bid_year,submission.bidder_id,snapshot,draft,false);
  if not coalesce((result->>'saved')::boolean,false) then raise exception 'No preference save failed: %',result; end if;
  if result->'snapshot'->'assignment'->>'fatigue_group' is not null
    or result->'snapshot'->'rdo'->'payload'->>'fatigueGroup' is not null then
    raise exception 'No preference was not persisted as null';
  end if;
end $test$;
select 'PASS: approved RDO accepts blank/null no preference and rejects invalid groups; all test edits rolled back' result;
rollback;
