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
await db.exec(await read('unused_slot_closures.sql'));
await db.exec(`select save_slot_closure_rule(2027,'Area A','cpc',3,2)`);
await assert.rejects(db.query(`select apply_slot_closure_rule(2027,'Area A','cpc')`),/must end/);
await db.exec(`update bid_rounds set status='closed'`);
const devBefore = (await db.query(`select * from leave_slots where slot_group='dev' order by id`)).rows;
const result = (await db.query(`select apply_slot_closure_rule(2027,'Area A','cpc') as result`)).rows[0].result;
assert.equal(result.closed_slots,3);
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
await db.close();
console.log('PASS closure SQL executes: cutoff, pending protection, occupied protection, holiday exception, CPC/DEV isolation, and repeat guard');
