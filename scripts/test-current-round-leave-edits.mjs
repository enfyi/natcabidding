// Local PostgreSQL regression: PGLITE_MODULE may point to a temporary install.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email',current_setting('test.email',true))$$;`);
  const files = ['schema.sql','seed.sql','ghost_bidding.sql','transactional_bidding.sql','high_priority_bidding_fixes.sql','rdo_line_eligibility.sql','leave_submission_preflight.sql','resolve_bidding_sql_conflicts.sql','holiday_leave_round_rules.sql','member_leave_request_management.sql','member_leave_request_replacement.sql','reject_unchanged_leave_rebid.sql','admin_leave_request_edit.sql','admin_bidder_editor.sql','round_one_flexible_week_buckets.sql','round_two_three_rdo_limits.sql','round_four_holiday_allowances.sql','holiday_slot_reservations.sql'];
  for (const file of files) {
    await db.exec(read(`database/${file}`).replaceAll('create extension if not exists pgcrypto;', '').replaceAll('create extension if not exists pgcrypto with schema extensions;', ''));
  }
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const year = (await db.query('select id from bid_years where bid_year=2027')).rows[0].id;
  const area = (await db.query('select id from areas limit 1')).rows[0].id;
  await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,role,bid_role,leave_slot_allowance) values
    ('${id(901)}','${id(902)}','${area}','Admin','Regression','AR','admin-regression@example.test','admin','CPC',1000),
    ('${id(903)}','${id(904)}','${area}','Leave','Regression','LR','leave-regression@example.test','controller','CPC',1000);
    insert into leave_requests(id,bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days) values
    ('${id(905)}','${year}','${id(903)}',2,1,'approved','2027-06-07','2027-06-08',2),
    ('${id(906)}','${year}','${id(903)}',2,2,'pending','2027-07-05','2027-07-05',1);
    insert into leave_request_dates(leave_request_id,leave_date,charged) values
    ('${id(905)}','2027-06-07',true),('${id(905)}','2027-06-08',true),('${id(906)}','2027-07-05',true);
    set test.uid='${id(902)}'; set test.email='admin-regression@example.test';`);
  const call = (start, end) => db.query('select private.replace_approved_leave_request_dates_unchecked($1,$2,$3,true) as result', [id(905), start, end]);
  await db.exec(read('database/intake_review_access.sql').split('do $migration$')[0]);
  await db.exec(`alter table public.bid_year_settings add column if not exists pilot_database boolean default false,
    add column if not exists pilot_enabled boolean default false,
    add column if not exists pilot_open_rounds integer[] default '{}';
    insert into bid_year_settings(bid_year_id) values ('${year}') on conflict do nothing;
    update bid_year_settings set pilot_database=true,pilot_enabled=true,pilot_open_rounds=array[2] where bid_year_id='${year}';`);
  const migration = read('database/current_round_leave_date_edits.sql');
  await db.exec(migration); await db.exec(migration);
  const otherArea = (await db.query('select id from areas where id<>$1 limit 1', [area])).rows[0].id;
  await db.exec(`update bidders set role='intake',area_id='${otherArea}' where id='${id(901)}'`);
  for (const round of [1,2,3,4,5,6]) {
    await db.query('update leave_requests set round_number=$1 where id=$2',[round,id(905)]);
    if (round === 2) assert.equal((await call('2027-06-09','2027-06-09')).rows[0].result.start_date,'2027-06-09');
    else await assert.rejects(() => call('2027-06-10','2027-06-10'),/current round/);
  }
  await db.exec(`update bidders set role='admin' where id='${id(901)}'`);
  for (const round of [1,2,3,4]) {
    await db.query('update leave_requests set round_number=$1 where id=$2',[round,id(905)]);
    await db.query('select private.assert_intake_leave_round_open($1)',[id(905)]);
    const day = round % 2 ? '2027-06-10' : '2027-06-11';
    assert.equal((await call(day,day)).rows[0].result.start_date, day);
  }
  // The editor must reject cross-round edits before staging or writing leave.
  await db.exec(`update bidders set role='intake' where id='${id(901)}'`);
  const snapshot=(await db.query('select private.bidder_editor_snapshot($1,$2) as data',[year,id(903)])).rows[0].data;
  const changes={rdo:null,leave:snapshot.leave.map(row=>({id:row.id,start_date:row.requested_start_date,end_date:row.requested_end_date}))};
  changes.leave.find(row=>row.id===id(905)).start_date='2027-06-12';
  changes.leave.find(row=>row.id===id(905)).end_date='2027-06-12';
  await assert.rejects(()=>db.query('select private.save_bidder_editor(2027,$1,$2,$3)',[id(903),snapshot,changes]),/current round/);
  assert.deepEqual((await db.query('select private.bidder_editor_snapshot($1,$2) data',[year,id(903)])).rows[0].data,snapshot);
  await db.exec(read('database/fatigue_group_balancing.sql'));
  // A direct call to the lower-level helper cannot bypass the round check.
  await assert.rejects(()=>db.query('select private.replace_bidder_editor_leave_dates($1,$2,$3,false,null)',
    [id(905),'2027-06-12','2027-06-12']),/current round/);
  // Saving an unchanged older round is allowed during normal recalculation.
  await db.exec(`insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code,status)
    values ('${year}','${area}','2027-06-11','cpc','TEST-OPEN','open'),
      ('${year}','${area}','2027-07-05','cpc','TEST-OPEN','open');`);
  await db.exec(`insert into rdo_lines(id,bid_year_id,area_id,line_code,pattern,status) values ('${id(920)}','${year}','${area}','TEST-RDO','S/S','open')`);
  const unchanged={rdo:{line_id:id(920),fatigue_group:null,flex:false,aws:false,mid:'No'},leave:snapshot.leave.map(row=>({id:row.id,start_date:row.requested_start_date,end_date:row.requested_end_date}))};
  assert.equal((await db.query('select private.save_bidder_editor(2027,$1,$2,$3) as result',
    [id(903),snapshot,unchanged])).rows[0].result.saved,true);
  // Exercise live schedule selection and scheduled intake, not just pilot controls.
  await db.exec(`update bid_year_settings set pilot_database=false where bid_year_id='${year}';
    delete from bid_windows where bid_year_id='${year}';
    insert into bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at) values
      ('${year}','${id(903)}',1,now()-interval '2 days',now()-interval '1 day'),
      ('${year}','${id(903)}',2,now()-interval '1 hour',now()+interval '1 hour');
    update leave_requests set round_number=1 where id='${id(905)}';`);
  await assert.rejects(()=>call('2027-06-12','2027-06-12'),/current round/);
  await db.exec(`update leave_requests set round_number=2 where id='${id(905)}'`);
  await db.query('select private.assert_intake_leave_date_round($1)',[id(905)]);
  await db.exec(`update bidders set role='controller' where id='${id(901)}'`);
  await assert.rejects(()=>call('2027-06-12','2027-06-12'),/access is required/);
  await db.exec(`insert into intake_schedules(bid_year_id,intake_user_id,starts_at,ends_at) values ('${year}','${id(901)}',now()-interval '1 hour',now()+interval '1 hour')`);
  await db.query('select private.assert_intake_leave_date_round($1)',[id(905)]);
  await db.exec(`update bidders set active=false where id='${id(901)}'`);
  await assert.rejects(()=>call('2027-06-12','2027-06-12'),/access is required/);
  await db.exec(`create function public.read_leave_intake_queue(queue_bid_year integer) returns table(id uuid,bidder_id uuid,round_number integer,status text,created_at timestamptz)
    language sql security definer set search_path=public as $$select lr.id,lr.bidder_id,lr.round_number,lr.status,lr.created_at
      from leave_requests lr join bidders target on target.id=lr.bidder_id join bid_years y on y.id=lr.bid_year_id
      where y.bid_year=queue_bid_year and (private.can_review_intake_year(y.id)
        or target.area_id=(select area_id from bidders where auth_user_id=auth.uid()))$$;
    update bidders set active=true,role='intake' where id='${id(901)}';`);
  await db.exec(read('database/leave_date_edit_history.sql'));
  await db.exec(read('database/leave_date_edit_history.sql'));
  const queue=()=>db.query('select private.read_leave_intake_queue_with_weeks(2027) as data');
  const historyBefore=(await queue()).rows[0].data.find(row=>row.id===id(905)).leaveEditHistory;
  assert.ok(historyBefore.length>=4,'Earlier direct edits are included');
  assert.equal(historyBefore[0].editedBy,'AR');
  const beforeLeave={id:id(905),requested_start_date:'2027-06-11',requested_end_date:'2027-06-11'};
  const afterLeave={...beforeLeave,requested_start_date:'2027-06-14',requested_end_date:'2027-06-14'};
  await db.query(`insert into audit_events(bid_year_id,area_id,actor_id,event_type,entity_table,entity_id,details)
    values($1,$2,$3,'bidder_bids_edited','bidders',$4,$5)`,[year,area,id(901),id(903),{before:{leave:[beforeLeave]},after:{leave:[afterLeave]}}]);
  const historyAfter=(await queue()).rows[0].data.find(row=>row.id===id(905)).leaveEditHistory;
  assert.equal(historyAfter.length,historyBefore.length+1,'Bidder-editor snapshot edits are included');
  assert.ok(historyAfter.some(edit=>edit.before.start_date==='2027-06-11' && edit.after.start_date==='2027-06-14'));
  await db.exec(`update bidders set role='controller' where id='${id(901)}'; delete from intake_schedules;`);
  assert.equal((await queue()).rows[0].data.length,0,'History does not expose another area to regular members');
  await db.exec("set test.uid=''");
  assert.deepEqual((await queue()).rows[0].data,[],'Anonymous callers cannot read history');
  console.log('PASS database history includes old direct edits and bidder-editor snapshots, preserves scope and rejects anonymous reads.');
  console.log('PASS database current-round restrictions: intake roles/schedules, pilot/live, rounds 1–6, admin cross-round saves and editor rollback.');
} finally { await db.close(); }
