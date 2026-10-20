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
  await db.exec(read('supabase/migrations/20260928021500_atomic_member_leave_batch_replacement.sql'));
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
  await db.exec(`create or replace function public.current_bidder_id() returns uuid language sql as $$select id from public.bidders where auth_user_id=auth.uid() and active limit 1$$;
    create or replace function public.is_current_admin() returns boolean language sql as $$select exists(select 1 from public.bidders where id=public.current_bidder_id() and role='admin')$$;`);
  await db.exec(read('database/unused_slot_closures.sql'));
  await db.exec(read('database/reopen_unused_slots.sql'));
  await db.exec(`update bid_rounds set status='closed' where bid_year_id='${year}' and round_number=3;
    insert into bid_rounds(bid_year_id,round_number,label,status) values('${year}',3,'Round 3','closed') on conflict(bid_year_id,round_number) do update set status='closed';
    insert into bid_year_settings(bid_year_id,enforce_bid_windows,test_bid_round) values('${year}',false,2) on conflict(bid_year_id) do update set enforce_bid_windows=false,test_bid_round=2;
    delete from leave_slots where bid_year_id='${year}' and area_id='${area}' and slot_date in ('2027-06-09','2027-06-10');
    insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code,status,slot_initials)
    select '${year}','${area}',d::date,'cpc','C'||n,case when d='2027-06-09' and n<=2 then 'approved' else 'open' end,
      case when d='2027-06-09' and n<=2 then 'XX'||n else null end
      from (values('2027-06-09'),('2027-06-10')) dates(d) cross join generate_series(1,3) n;
    select public.save_slot_closure_rule(2027,(select name from areas where id='${area}'),'cpc',3,1);
    insert into bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at) values('${year}','${id(903)}',2,now()-interval '1 hour',now()+interval '1 hour') on conflict(bid_year_id,bidder_id,round_number) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at;`);
  const edit = (start,end,override=false) => db.query('select private.replace_approved_leave_request_dates_unchecked($1,$2,$3,$4)',[id(905),start,end,override]);
  // The same guard applies before a closure, at the original three-slot limit.
  await db.exec(`update leave_slots set status='approved',slot_initials='YY' where bid_year_id='${year}' and area_id='${area}' and slot_date='2027-06-09' and slot_code='C3'`);
  await assert.rejects(()=>edit('2027-06-09','2027-06-09'),/No CPC leave slot is available/);
  await db.exec(`set test.uid='${id(904)}'; set test.email='leave-regression@example.test';`);
  await assert.rejects(()=>db.query('select public.replace_own_leave_request($1,$2,$3)',[id(905),'2027-06-09','2027-06-09']),/No CPC leave slot is available/);
  await db.exec(`set test.uid='${id(902)}'; set test.email='admin-regression@example.test';`);
  await db.exec(`update leave_slots set status='open',slot_initials=null where bid_year_id='${year}' and area_id='${area}' and slot_date='2027-06-09' and slot_code='C3';
    select public.apply_slot_closure_rule(2027,(select name from areas where id='${area}'),'cpc');`);
  for (const role of ['admin','intake']) {
    await db.exec(`update bidders set role='${role}' where id='${id(901)}'`);
    await assert.rejects(()=>edit('2027-06-09','2027-06-09'),/No CPC leave slot is available/);
    assert.equal((await db.query('select requested_start_date::text as day from leave_requests where id=$1',[id(905)])).rows[0].day,'2027-06-07');
  }
  await edit('2027-06-10','2027-06-10');
  assert.equal((await db.query('select requested_start_date::text as day from leave_requests where id=$1',[id(905)])).rows[0].day,'2027-06-10');
  await db.exec(`set test.uid='${id(904)}'; set test.email='leave-regression@example.test';`);
  await assert.rejects(()=>db.query('select public.replace_own_leave_request($1,$2,$3)',[id(905),'2027-06-09','2027-06-09']),/No CPC leave slot is available/);
  assert.equal((await db.query('select status,requested_start_date::text as day from leave_requests where id=$1',[id(905)])).rows[0].day,'2027-06-10');
  await assert.rejects(()=>db.query('select public.replace_own_leave_request_batch($1::uuid[],$2::jsonb)',[[id(905)],JSON.stringify([{start_date:'2027-06-09',end_date:'2027-06-09',round:2}])]),/No CPC leave slot is available/);
  assert.equal((await db.query('select status from leave_requests where id=$1',[id(905)])).rows[0].status,'approved');
  await db.exec(`update bidders set role='admin' where id='${id(901)}';
    set test.uid='${id(902)}'; set test.email='admin-regression@example.test';
    insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status,assigned_bidder_id)
      values('${id(907)}','${year}','${area}','REOPEN-LR','CPC','WORK','taken','${id(903)}');
    insert into rdo_line_days(rdo_line_id,weekday,shift_code) select '${id(907)}',n,'0700' from generate_series(0,6) n;`);
  const beforeReopen = async () => (await db.query(`select jsonb_build_object(
    'requests',(select jsonb_agg(to_jsonb(r) order by id) from leave_requests r),
    'dates',(select jsonb_agg(to_jsonb(d) order by leave_request_id,leave_date) from leave_request_dates d),
    'submissions',(select jsonb_agg(to_jsonb(s) order by id) from intake_submissions s),
    'awarded_slots',(select jsonb_agg(to_jsonb(s) order by id) from leave_slots s where bidder_id is not null or source_leave_request_id is not null or nullif(trim(slot_initials),'') is not null)
  ) as snapshot`)).rows[0].snapshot;
  const originalBids = await beforeReopen();
  const reopened = await db.query(`select reopen_slot_closure_rule(2027,(select name from areas where id=$1),'cpc','2027-06-09','2027-06-09') as result`,[area]);
  assert.equal(reopened.rows[0].result.reopened_slots,1);
  assert.deepEqual(await beforeReopen(),originalBids,'Reopening cannot modify approved/pending requests, dates, submissions, or assigned slots');
  // Explicit date edits, performed after reopening, can now use the restored slot.
  await edit('2027-06-09','2027-06-09');
  assert.equal((await db.query('select requested_start_date::text as day from leave_requests where id=$1',[id(905)])).rows[0].day,'2027-06-09');
  await db.query(`select reopen_slot_closure_rule(2027,(select name from areas where id=$1),'cpc','2027-06-10','2027-06-10')`,[area]);
  await db.exec(`set test.uid='${id(904)}'; set test.email='leave-regression@example.test';`);
  await db.query('select public.replace_own_leave_request($1,$2,$3)',[id(905),'2027-06-10','2027-06-10']);
  const memberRequest = (await db.query(`select id from leave_requests where bidder_id=$1 and status='pending' and requested_start_date='2027-06-10'`,[id(903)])).rows[0];
  assert.ok(memberRequest,'Member date replacement succeeds with restored capacity');
  await db.query('select public.replace_own_leave_request_batch($1::uuid[],$2::jsonb)',[[memberRequest.id],JSON.stringify([{start_date:'2027-06-09',end_date:'2027-06-09',round:2}])]);
  assert.equal((await db.query(`select count(*)::int as n from leave_requests where bidder_id=$1 and status='pending' and requested_start_date='2027-06-09'`,[id(903)])).rows[0].n,1);
  console.log('PASS restored capacity permits admin, member single-date and batch replacements; reopening itself preserves existing bids');
  console.log('PASS admin/intake and member date edits enforce reduced capacity, allow open dates, and roll back rejected replacements');
} finally { await db.close(); }
