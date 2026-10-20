import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;`);
const read = name => readFile(new URL('../database/'+name,import.meta.url),'utf8');
await db.exec((await read('schema.sql')).replace('create extension if not exists pgcrypto;',''));
await db.exec(`create function public.is_current_admin() returns boolean language sql as $$select true$$;
create function public.current_bidder_id() returns uuid language sql as $$select id from public.bidders where initials='AD'$$;
alter table leave_requests add column if not exists is_ghost_bid boolean not null default false;
create table if not exists leave_slot_capacities(bid_year_id uuid,area_id uuid,slot_date date,cpc_capacity int,dev_capacity int,updated_by uuid,updated_at timestamptz default now(),unique(bid_year_id,area_id,slot_date));
insert into bid_years(bid_year) values(2027);
insert into areas(code,name) values('area-a','Area A');
insert into bidders(area_id,first_name,last_name,initials,role,bid_role) select id,'Admin','Test','AD','admin','CPC' from areas;
insert into bidders(area_id,first_name,last_name,initials,bid_role) select id,'Pending','Test','PN','CPC' from areas;
insert into bid_rounds(bid_year_id,round_number,label,status) select id,3,'Round 3','open' from bid_years;
insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
select y.id,a.id,d::date,g,upper(left(g,1))||n from bid_years y cross join areas a
cross join (values('2027-06-10'),('2027-06-11'),('2027-06-12'),('2027-12-22')) dates(d)
cross join (values('cpc'),('dev')) groups(g) cross join generate_series(1,4) n
where g='dev' or n<=3 or d='2027-12-22';
insert into holidays(bid_year_id,holiday_date,name) select id,'2027-12-25','Christmas' from bid_years;
update leave_slots set bidder_id=(select id from public.bidders where initials='AD'),slot_initials='AD',status='approved' where slot_group='cpc' and slot_code='C1';
insert into leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date)
select y.id,b.id,3,1,'pending','2027-06-11','2027-06-11' from bid_years y cross join bidders b where b.initials='PN';
insert into leave_request_dates(leave_request_id,leave_date,charged) select id,'2027-06-11',true from leave_requests;
update leave_slots set status='approved',slot_initials='XX' where slot_date='2027-06-12' and slot_group='cpc';`);
await db.exec(`insert into leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days)
 select y.id,b.id,3,2,'approved','2027-06-10','2027-06-10',1 from bid_years y cross join bidders b where b.initials='AD';
 insert into leave_request_dates(leave_request_id,leave_date,charged) select id,'2027-06-10',true from leave_requests where status='approved';
 update leave_slots set source_leave_request_id=(select id from leave_requests where status='approved') where slot_date='2027-06-10' and slot_group='cpc' and slot_code='C1';
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code,status)
 select y.id,a.id,'2027-06-12','cpc','MANUAL-CLOSED','unavailable' from bid_years y cross join areas a;`);
await db.exec(await read('unused_slot_closures.sql'));
await db.exec(await read('reopen_unused_slots.sql'));
// Preserve full records, not only counts, to catch changed dates, status,
// ownership, accounting, or history on any existing request or occupied slot.
const bidTables = ['leave_requests','leave_request_dates','leave_request_week_buckets','intake_submissions','leave_credit_events','rdo_lines','rdo_line_days','bidders','bid_windows'];
const bidSnapshot = async () => {
  const snapshot = {};
  for (const table of bidTables) snapshot[table] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as rows from public.${table} t`)).rows[0].rows;
  snapshot.occupied = (await db.query(`select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') as rows from leave_slots s where bidder_id is not null or source_leave_request_id is not null or nullif(trim(slot_initials),'') is not null or status in ('pending','approved','held')`)).rows[0].rows;
  return snapshot;
};
const bidsBefore = await bidSnapshot();
await db.exec(`select save_slot_closure_rule(2027,'Area A','cpc',3,2)`);
await assert.rejects(db.query(`select apply_slot_closure_rule(2027,'Area A','cpc')`),/must end/);
await db.exec(`update bid_rounds set status='closed'`);
const devBefore = (await db.query(`select * from leave_slots where slot_group='dev' order by id`)).rows;
const result = (await db.query(`select apply_slot_closure_rule(2027,'Area A','cpc') as result`)).rows[0].result;
assert.equal(result.closed_slots,3);
assert.deepEqual(await bidSnapshot(),bidsBefore,'Closing must not alter any existing bid record or occupied slot');
assert.deepEqual((await db.query(`select * from leave_slots where slot_group='dev' order by id`)).rows,devBefore);
const caps = (await db.query(`select slot_date::text as day,cpc_capacity from leave_slot_capacities order by slot_date`)).rows;
assert.deepEqual(caps,[{day:'2027-06-10',cpc_capacity:1},{day:'2027-06-11',cpc_capacity:2}]);
assert.equal((await db.query(`select count(*)::int as n from leave_slots where slot_date='2027-06-11' and slot_group='cpc' and status='open'`)).rows[0].n,1,'Pending bid retains an available slot');
assert.equal((await db.query(`select count(*)::int as n from leave_slots where slot_date='2027-12-22' and slot_group='cpc' and status<>'unavailable'`)).rows[0].n,4);
await assert.rejects(db.query(`select apply_slot_closure_rule(2027,'Area A','cpc')`),/already been applied/);
await db.exec(await read('public_leave_slots_read.sql'));
const schedule = (await db.query('select read_public_leave_slots(2027) as schedule')).rows[0].schedule;
const full = schedule.find(day => day.slot_date === '2027-06-10');
assert.equal(full.cpc_capacity,1);
assert.equal(full.cpc_open,0);
assert.equal(full.dev_capacity,4);
assert.equal(full.dev_open,4);
assert.equal(full.unavailable,false,'Closing CPC slots must not mark the whole date unavailable for DEV');
const reopen = async (start=null,end=null) => (await db.query("select reopen_slot_closure_rule(2027,'Area A','cpc',$1::date,$2::date) as result",[start,end])).rows[0].result;
await assert.rejects(()=>reopen('2027-06-10',null),/Choose both dates/);
await assert.rejects(()=>reopen('2027-06-11','2027-06-10'),/Choose both dates/);
await assert.rejects(()=>reopen('2027-01-09','2027-06-10'),/Choose both dates/);
assert.equal((await reopen('2027-06-10','2027-06-10')).reopened_slots,2);
let restored = (await db.query('select read_public_leave_slots(2027) as schedule')).rows[0].schedule;
assert.equal(restored.find(d=>d.slot_date==='2027-06-10').cpc_capacity,3);
assert.equal(restored.find(d=>d.slot_date==='2027-06-10').cpc_open,2);
assert.equal(restored.find(d=>d.slot_date==='2027-06-11').cpc_capacity,2,'Dates outside the range retain reduced capacity');
assert.deepEqual(await bidSnapshot(),bidsBefore,'Reopening must preserve every existing bid field and assigned slot');
assert.equal((await reopen('2027-06-10','2027-06-10')).reopened_slots,0,'Repeated reopening cannot add capacity');
assert.equal((await reopen()).reopened_slots,1,'Reopen all restores only remaining closed slots');
assert.deepEqual(await bidSnapshot(),bidsBefore);
assert.deepEqual((await db.query(`select * from leave_slots where slot_group='dev' order by id`)).rows,devBefore);
assert.equal((await db.query(`select closed_slots::int as n from read_slot_closure_rules(2027) where slot_group='cpc'`)).rows[0].n,0);
await assert.rejects(db.query(`select apply_slot_closure_rule(2027,'Area A','cpc')`),/already been applied/);
assert.equal((await db.query(`select status from leave_slots where slot_code='MANUAL-CLOSED'`)).rows[0].status,'unavailable');
// Exercise the real TMU/other-area and CPC/DEV capacities, including full ->
// reopened -> full after the new slot is taken.
await db.exec(`insert into areas(code,name) values('area-b','Area B'),('tmu','TMU');
 insert into bid_rounds(bid_year_id,round_number,label,status) select id,2,'Round 2','closed' from bid_years;`);
for (const [area,group,capacity] of [['Area B','cpc',3],['Area B','dev',4],['TMU','cpc',2],['TMU','dev',2]]) {
 await db.query(`insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code,status,slot_initials)
   select y.id,a.id,'2027-08-10',$2,'TEST-'||n,case when n<$3 then 'approved' else 'open' end,
     case when n<$3 then 'OCC-'||n else null end
     from bid_years y cross join areas a cross join generate_series(1,$3::int) n where a.name=$1`,[area,group,capacity]);
 const before = await bidSnapshot();
 await db.query(`select save_slot_closure_rule(2027,$1,$2,$3,1)`,[area,group,area==='TMU'?2:3]);
 await db.query(`select apply_slot_closure_rule(2027,$1,$2)`,[area,group]);
 let d=(await db.query('select read_public_leave_slots(2027) as schedule')).rows[0].schedule.find(d=>d.area_name===area&&d.slot_date==='2027-08-10');
 assert.equal(d[group+'_capacity'],capacity-1); assert.equal(d[group+'_open'],0);
 await db.query(`select reopen_slot_closure_rule(2027,$1,$2,'2027-08-10','2027-08-10')`,[area,group]);
 d=(await db.query('select read_public_leave_slots(2027) as schedule')).rows[0].schedule.find(d=>d.area_name===area&&d.slot_date==='2027-08-10');
 assert.equal(d[group+'_capacity'],capacity); assert.equal(d[group+'_open'],1);
 assert.deepEqual(await bidSnapshot(),before,'Original bids and occupied rows remain identical throughout close/reopen');
 await db.query(`update leave_slots set status='approved',slot_initials='NEW' where slot_code like 'REOPENED-%' and slot_date='2027-08-10' and slot_group=$2 and area_id=(select id from areas where name=$1)`,[area,group]);
 d=(await db.query('select read_public_leave_slots(2027) as schedule')).rows[0].schedule.find(d=>d.area_name===area&&d.slot_date==='2027-08-10');
 assert.equal(d[group+'_open'],0,'Taking the reopened slot marks the date full at the restored capacity');
}
await db.exec(`create or replace function public.is_current_admin() returns boolean language sql as $$select false$$;`);
await assert.rejects(()=>reopen(),/Only system admins/);
await db.close();
console.log('PASS reopening: selected dates, restored capacity, no double restoration, workforce isolation, authorization, and unchanged bid snapshots');
console.log('PASS closure SQL executes: cutoff, pending protection, occupied protection, holiday exception, CPC/DEV isolation, and repeat guard');
