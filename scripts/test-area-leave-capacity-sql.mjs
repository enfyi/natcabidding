import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const databaseUrl = process.env.AREA_CAPACITY_TEST_DATABASE_URL;
let db;
let Client;
if (databaseUrl) {
  const pg = await import(process.env.PG_MODULE || 'pg');
  Client = pg.Client || pg.default.Client;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  db = { exec: sql => client.query(sql), query: (sql, params) => client.query(sql, params), close: () => client.end() };
} else {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  db = new PGlite();
}
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const year = id(2027), area = id(100), line = id(200);
await db.exec(`
create schema auth; create schema private; create role anon; create role authenticated;
create function auth.uid() returns uuid language sql as $$select current_setting('test.actor')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select '{"email":"test@example.invalid"}'::jsonb$$;
create table public.areas(id uuid primary key, name text);
create table public.bid_years(id uuid primary key, bid_year integer);
create table public.bidders(id uuid primary key, auth_user_id uuid, email text, initials text, active boolean default true, role text default 'bue', area_id uuid, bid_role text, leave_slot_allowance integer);
create table public.bidder_bid_year_settings(bid_year_id uuid, bidder_id uuid, is_ghost_bidder boolean);
create table public.bid_year_settings(bid_year_id uuid, enforce_bid_windows boolean, test_bid_round integer);
create table public.rdo_lines(id uuid primary key, bid_year_id uuid, assigned_bidder_id uuid, status text, updated_at timestamptz);
create table public.rdo_line_days(rdo_line_id uuid, weekday smallint, is_rdo boolean);
create table public.holidays(bid_year_id uuid, holiday_date date);
create table public.holiday_in_lieu_days(bid_year_id uuid, bidder_id uuid, in_lieu_date date);
create table public.bid_windows(bid_year_id uuid, bidder_id uuid, round_number integer, opens_at timestamptz, closes_at timestamptz);
create table public.leave_requests(id uuid primary key default gen_random_uuid(), bid_year_id uuid, bidder_id uuid, round_number integer, priority integer, status text, requested_start_date date, requested_end_date date, charged_days integer, notes text, submitted_at timestamptz, is_ghost_bid boolean default false);
create table public.leave_request_dates(leave_request_id uuid, leave_date date, charged boolean, is_rdo boolean, is_holiday boolean, is_holiday_in_lieu boolean);
create table public.leave_request_week_buckets(leave_request_id uuid, bucket_start_date date, bucket_end_date date);
create table public.intake_submissions(id uuid default gen_random_uuid(), bid_year_id uuid, area_id uuid, bidder_id uuid, round_number integer, leave_request_id uuid, submission_type text, status text, payload jsonb, submitted_at timestamptz, is_ghost_bid boolean, rdo_line_id uuid, reviewed_at timestamptz, created_at timestamptz default now());
create table public.audit_events(bid_year_id uuid, area_id uuid, actor_id uuid, event_type text, entity_table text, details jsonb);
create function public.is_ghost_bidder(y uuid, b uuid) returns boolean language sql as $$select coalesce((select is_ghost_bidder from public.bidder_bid_year_settings where bid_year_id=y and bidder_id=b), false)$$;
create function public.effective_rdo_line_id(y uuid, b uuid) returns uuid language sql as $$select id from public.rdo_lines where bid_year_id=y and assigned_bidder_id=b and status='taken' limit 1$$;
create function private.gl_leave_bucket(y uuid, b uuid) returns text language sql as $$select coalesce(current_setting('test.gl_bucket',true), 'cpc')$$;
create function private.round_four_limit_for_line(uuid) returns integer language sql as $$select 100$$;
create function private.round_two_three_limit_for_line(uuid) returns integer language sql as $$select 100$$;
create function private.round_one_week_bucket_starts(date[]) returns date[] language sql as $$select array[]::date[]$$;
create function private.rebuild_round_one_week_buckets(uuid,uuid) returns void language sql as $$select$$;
insert into public.areas values ('${area}', 'Area A');
insert into public.bid_years values ('${year}',2027);
insert into public.bid_year_settings values ('${year}',false,null);
insert into public.bidders(id,auth_user_id,email,initials,area_id,bid_role,leave_slot_allowance) values
 ('${id(1)}','${id(1)}','test@example.invalid','CP','${area}','CPC',16),
 ('${id(2)}','${id(2)}','test@example.invalid','DV','${area}','DEV',16),
 ('${id(3)}','${id(3)}','test@example.invalid','GL','${area}','GL',800),
 ('${id(4)}','${id(4)}','test@example.invalid','GH','${area}','CPC',800),
 ('${id(5)}','${id(5)}','test@example.invalid','IN','${area}','ADM',800);
update public.bidders set role='intake' where initials='IN';
insert into public.bidder_bid_year_settings values ('${year}','${id(4)}',true);
insert into public.rdo_lines values ('${line}','${year}','${id(1)}','taken',now());
insert into public.rdo_line_days values ('${line}',0,true);
insert into public.holidays values ('${year}','2027-02-02');
select set_config('test.actor','${id(1)}',false);
`);
const canonical = await readFile(new URL('../database/round_four_holiday_allowances.sql', import.meta.url),'utf8');
const start = canonical.indexOf('create or replace function private.submit_leave_bid_batch_unchecked(');
await db.exec(process.env.LEAVE_WRITER_FIXTURE
  ? await readFile(process.env.LEAVE_WRITER_FIXTURE, 'utf8')
  : canonical.slice(start,canonical.indexOf('create or replace function public.submit_leave_bid_batch(',start)));
const migration = await readFile(new URL('../database/enforce_area_leave_capacity.sql', import.meta.url),'utf8');
assert.equal(migration,await readFile(new URL('../supabase/migrations/20261105202006_enforce_area_leave_capacity.sql', import.meta.url),'utf8'));
await db.exec(migration);
await db.exec(migration); // Reapplying must not duplicate the guard.
const scalar = async sql => (await db.query(sql)).rows[0];
const balance = bucket => scalar(`select * from private.area_leave_balance_days('${year}','${area}','${bucket}')`);
const actor = n => db.query("select set_config('test.actor',$1,false)",[id(n)]);
const submit = (dates, initials=null, manual=false, round=4) => db.query(
 'select private.submit_leave_bid_batch_unchecked(2027,$1::jsonb,$2::text,$3::text,$4::boolean)',
 [JSON.stringify(dates.map(date=>({start_date:date,end_date:date,round}))),initials,initials?'Area A':null,manual]);
const clear = () => db.exec('truncate public.leave_requests,public.leave_request_dates,public.intake_submissions,public.audit_events');
assert.equal(Number((await balance('cpc')).total_days),2,'GL, ghost and admin allowances do not add area days');
await assert.rejects(submit(['2027-02-01','2027-02-02','2027-02-03']),/leave balance is exhausted/,'Holiday is an area day even when not charged personally');
assert.equal((await scalar('select count(*)::integer as n from public.leave_requests')).n,0,'Rejected batch writes nothing');
await submit(['2027-02-01','2027-02-02']);
assert.equal(Number((await balance('cpc')).remaining_days),0,'Exact capacity is accepted and pending dates reserve days');
await assert.rejects(submit(['2027-02-03']),/leave balance is exhausted/);
await db.exec("update public.leave_requests set status='approved'");
assert.equal(Number((await balance('cpc')).remaining_days),0,'Approval does not double-count reservations');
await actor(2);
await submit(['2027-02-03','2027-02-04']);
await assert.rejects(submit(['2027-02-05']),/leave balance is exhausted/,'DEV has separate enforced capacity');
await actor(3);
await assert.rejects(submit(['2027-02-05']),/leave balance is exhausted/,'GL blocked when its CPC bucket is exhausted');
for (const role of ['CPC','DEV','GL']) {
  await db.query("update public.bidders set bid_role=$1 where initials='GH'",[role]);
  await actor(4);
  await assert.rejects(submit(['2027-02-05']),/leave balance is exhausted/,`${role} ghost bidder blocked at zero`);
  await actor(5);
  await assert.rejects(submit(['2027-02-05'],'GH',true),/leave balance is exhausted/,`${role} manual ghost bid also blocked at zero`);
}
await db.exec("update public.bidders set bid_role='CPC' where initials='GH'");
await clear();
await actor(4);
await submit(['2027-02-01','2027-02-02','2027-02-03']);
assert.equal(Number((await balance('cpc')).used_days),0,'Ghost leave does not consume area days even when selection exceeds remaining days');
await clear();
await actor(5);
await assert.rejects(submit(['2027-02-01','2027-02-02','2027-02-03'],'CP',true),/leave balance is exhausted/,'Intaker cannot bypass area limit');
await db.exec("update public.bidders set role='admin' where initials='IN'");
await assert.rejects(submit(['2027-02-01','2027-02-02','2027-02-03'],'DV',true),/leave balance is exhausted/,'Admin manual entry also enforces DEV limit');
await actor(1);
await assert.rejects(submit(['2027-02-01'],'DV',true),/reviewer access/,'Migration preserves reviewer authorization');
await submit(['2027-02-01']);
await actor(3);
await submit(['2027-02-02','2027-02-03']);
assert.equal(Number((await balance('cpc')).remaining_days),1,'GL may bid without consuming remaining area days');
await db.exec("select set_config('test.gl_bucket','dev',false); update public.bidders set leave_slot_allowance=0 where initials='DV'");
await assert.rejects(submit(['2027-02-04']),/Area A DEV leave balance is exhausted/,'GL uses its applicable line bucket');
await db.exec("update public.leave_requests set status='denied' where bidder_id='"+id(1)+"'");
assert.equal(Number((await balance('cpc')).remaining_days),2,'Denied leave releases capacity');
await clear();
await actor(1);
await submit(['2027-02-06','2027-02-07'],null,false,1);
assert.equal(Number((await balance('cpc')).used_days),1,'Round 1 RDO dates do not consume area days');
await db.exec("update public.leave_requests set status='cancelled'");
assert.equal(Number((await balance('cpc')).remaining_days),2,'Cancellation releases days');
await db.exec("update public.bidders set leave_slot_allowance=17 where initials='CP'");
assert.equal(Number((await balance('cpc')).total_days),3,'Area allowance rounds up per person');
const permissions = await scalar(`select has_function_privilege('authenticated','private.assert_area_leave_capacity(uuid,uuid,date[],uuid)','execute') as exposed`);
assert.equal(permissions.exposed,false,'Internal helper is not an RPC bypass');
const writer = (await scalar("select pg_get_functiondef('private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)'::regprocedure) as body")).body;
assert.equal(writer.split('perform private.assert_area_leave_capacity(').length-1,1,'Installer injects one guard before writes');
// PGlite is single-connection; the native Postgres test exercises lock contention.
assert.match(migration, /pg_advisory_xact_lock/);
if (databaseUrl) {
  await clear();
  await db.exec("update public.bidders set leave_slot_allowance=8 where initials='CP'; update public.bidders set bid_role='CPC',leave_slot_allowance=0 where initials='DV'");
  const first = new Client({ connectionString: databaseUrl });
  const second = new Client({ connectionString: databaseUrl });
  await first.connect(); await second.connect();
  try {
    await first.query('begin'); await second.query('begin');
    await first.query("select set_config('test.actor',$1,true)",[id(1)]);
    await second.query("select set_config('test.actor',$1,true)",[id(2)]);
    const secondPid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
    const sql = 'select private.submit_leave_bid_batch_unchecked(2027,$1::jsonb)';
    const batch = date => JSON.stringify([{start_date:date,end_date:date,round:4}]);
    await first.query(sql,[batch('2027-02-01')]);
    let finished = false;
    const competing = second.query(sql,[batch('2027-02-03')]).then(
      () => { finished = true; return null; }, error => { finished = true; return error; });
    let waiting;
    for (let attempt=0; attempt<100; attempt++) {
      waiting = (await db.query('select wait_event from pg_stat_activity where pid=$1',[secondPid])).rows[0]?.wait_event;
      if (waiting === 'advisory' || finished) break;
      await new Promise(resolve => setTimeout(resolve,10));
    }
    assert.equal(waiting,'advisory','Different-date bids wait on the same area balance lock');
    assert.equal(finished,false,'Second bid cannot reserve the last day before the first commits');
    await first.query('commit');
    const error = await competing;
    assert.match(error?.message || '',/leave balance is exhausted/,'Waiting bidder sees the committed reservation and is rejected');
    await second.query('rollback');
    assert.equal(Number((await balance('cpc')).used_days),1,'Concurrent bids cannot overdraw the last area day');
    console.log('PASS native PostgreSQL concurrency: different bidders and dates serialize; waiting bid rechecks committed usage');
  } finally {
    await first.query('rollback'); await second.query('rollback');
    await first.end(); await second.end();
  }
}
await db.close();
console.log('PASS SQL writer: CPC/DEV, manual intake/admin, exact and exhausted capacity, holidays/RDOs, GL and ghost zero-day blocking, non-consuming ghost leave, release, rounding, atomic rejection, permissions and idempotence');
