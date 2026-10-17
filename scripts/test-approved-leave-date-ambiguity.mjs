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
  // Reproduce the installed bug before testing the forward migration.
  await db.exec(`do $$ begin execute replace(pg_get_functiondef('private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)'::regprocedure),
    'existing_date.leave_date between replacement_start_date and replacement_end_date',
    'existing_date.leave_date between requested_start_date and requested_end_date'); end $$;`);
  await assert.rejects(() => call('2027-06-09', '2027-06-10'), /requested_start_date.*ambiguous/);
  const migration = read('supabase/migrations/20261017151152_fix_approved_leave_date_ambiguity.sql');
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply.
  const result = (await call('2027-06-09', '2027-06-10')).rows[0].result;
  assert.equal(result.start_date, '2027-06-09');
  assert.equal(result.end_date, '2027-06-10');
  assert.equal(result.charged_days, 2);
  const request = (await db.query('select status,requested_start_date::text as start,requested_end_date::text as end from leave_requests where id=$1', [id(905)])).rows[0];
  assert.deepEqual(request, {status: 'approved', start: '2027-06-09', end: '2027-06-10'});
  const dates = (await db.query('select leave_date::text as day from leave_request_dates where leave_request_id=$1 order by leave_date', [id(905)])).rows.map(row => row.day);
  assert.deepEqual(dates, ['2027-06-09', '2027-06-10']);
  await assert.rejects(() => call('2027-07-05', '2027-07-05'), /already has one or more replacement dates/);
  assert.equal((await db.query('select count(*)::int as n from audit_events where entity_id=$1 and event_type=$2', [id(905),'approved_leave_dates_replaced'])).rows[0].n, 1);
  console.log('PASS: reproduced ambiguity; migration fixes approved-date edits, retains overlap rejection and audit, and reapplies safely.');
  const otherArea = (await db.query('select id from areas where id<>$1 limit 1', [area])).rows[0].id;
  await db.exec(`update bidders set role='intake',area_id='${otherArea}' where id='${id(901)}';
    do $$ begin execute replace(pg_get_functiondef('private.replace_approved_leave_request_dates_unchecked(uuid,date,date,boolean)'::regprocedure),
      '-- Authorized shared intake reviewers may edit bidders across areas.',
      'if actor.role <> ''admin'' and actor.area_id is distinct from target.area_id then
    raise exception ''Intake users can only replace approved leave in their own area.'';
  end if;'); end $$;`);
  await assert.rejects(() => call('2027-06-11', '2027-06-11'), /own area/);
  const accessMigration = read('supabase/migrations/20261017151806_align_approved_leave_dates_shared_intake_access.sql');
  await db.exec(accessMigration);
  await db.exec(accessMigration);
  assert.equal((await call('2027-06-11', '2027-06-11')).rows[0].result.start_date, '2027-06-11');
  await assert.rejects(() => call('2027-07-05', '2027-07-05'), /already has one or more replacement dates/);
  await db.exec(`update bidders set role='controller' where id='${id(901)}'`);
  await assert.rejects(() => call('2027-06-14', '2027-06-14'), /only be replaced by intake or an administrator/);
  await db.exec(`update bidders set role='intake',active=false where id='${id(901)}'`);
  await assert.rejects(() => call('2027-06-14', '2027-06-14'), /only be replaced by intake or an administrator/);
  console.log('PASS: cross-area intake date edit succeeds; regular members and inactive reviewers stay blocked.');
} finally {
  await db.close();
}
