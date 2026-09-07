// Local-only Postgres regression tests. Install @electric-sql/pglite in a temporary directory
// and set PGLITE_MODULE to its module path, or make it available to Node. No live database access.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email',current_setting('test.email',true))$$;`);
await db.exec(fs.readFileSync(root+'/database/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
await db.exec(`alter table rdo_lines add column assigned_initials text;
alter table intake_submissions add column round_number integer, add column rdo_line_id uuid, add column leave_request_id uuid;`);
await db.exec(fs.readFileSync(root+'/scripts/fixtures/bidder-editor-bidding-functions.sql','utf8').replaceAll('\n$function$\n','\n$function$;\n'));
await db.exec(fs.readFileSync(root+'/database/admin_bidder_editor.sql','utf8'));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`insert into bid_years(id,bid_year) values('${id(1)}',2027);
insert into areas(id,code,name) values('${id(2)}','area-a','Area A'),('${id(3)}','area-b','Area B');
insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,role,leave_slot_allowance) values
('${id(10)}','${id(110)}','${id(2)}','Admin','Test','AD','admin@example.test','admin',208),
('${id(11)}','${id(111)}','${id(2)}','Bidder','Test','BT','bidder@example.test','controller',208),
('${id(12)}','${id(112)}','${id(3)}','Intake','Test','IT','intake@example.test','intake',208);
insert into rdo_lines(id,bid_year_id,area_id,line_code,pattern,fatigue_group,status,assigned_bidder_id,assigned_initials) values
('${id(20)}','${id(1)}','${id(2)}','1','S/S','A','taken','${id(11)}','BT'),
('${id(21)}','${id(1)}','${id(2)}','2','S/S','B','open',null,null),
('${id(22)}','${id(1)}','${id(2)}','3','S/S','C','open',null,null);
insert into rdo_line_days(rdo_line_id,weekday,shift_code) select l.id,d,case when d in (0,6) then 'RDO' else '0700' end from rdo_lines l cross join generate_series(0,6) d;
insert into leave_requests(id,bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days) values
('${id(30)}','${id(1)}','${id(11)}',1,1,'approved','2027-06-07','2027-06-08',2),
('${id(31)}','${id(1)}','${id(11)}',2,1,'pending','2027-07-05','2027-07-06',2);
insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code) select '${id(1)}','${id(2)}',d,'cpc','1' from generate_series('2027-01-10'::date,'2028-01-08'::date,interval '1 day') d;
set test.uid='${id(110)}';set test.email='admin@example.test';`);
const snap=async()=> (await db.query(`select public.read_admin_bidder_editor(2027,$1) as x`,[id(11)])).rows[0].x.snapshot;
let expected=await snap();
let changes={rdo:{line_id:id(20),fatigue_group:'B',flex:true,aws:false,mid:'No'},leave:expected.leave.map(x=>({id:x.id,start_date:x.requested_start_date,end_date:x.requested_end_date}))};
const call=async(validate=true,c=changes,s=expected)=>(await db.query('select public.edit_admin_bidder(2027,$1,$2,$3,$4) x',[id(11),s,c,validate])).rows[0].x;
const valid=await call(); if(!valid.valid) { try { await call(false); } catch(e) { console.log(e.message,e.where); process.exit(1); } } assert.equal(valid.valid,true,JSON.stringify(valid));assert.deepEqual(await snap(),expected);assert.equal((await db.query('select count(*) n from audit_events')).rows[0].n,0);console.log('PASS dry-run rolls back complete state and audit');
const invalid=structuredClone(changes);invalid.leave[1].start_date='2027-06-07';invalid.leave[1].end_date='2027-06-08';
assert.equal((await call(true,invalid)).valid,false); await assert.rejects(()=>call(false,invalid));assert.deepEqual(await snap(),expected);console.log('PASS overlap rejected and failed save atomic');
const rdo=structuredClone(changes);rdo.leave[1].start_date='2027-07-10';rdo.leave[1].end_date='2027-07-10';assert.equal((await call(true,rdo)).valid,false);console.log('PASS RDO conflict');
const cap=structuredClone(changes);cap.leave[1].start_date='2027-07-07';cap.leave[1].end_date='2027-07-07';await db.exec("update leave_slots set status='unavailable' where slot_date='2027-07-07'");assert.equal((await call(true,cap)).valid,false);console.log('PASS capacity');
const outside=structuredClone(changes);outside.leave[0].start_date='2027-01-01';assert.equal((await call(true,outside)).valid,false);console.log('PASS bid-year bounds');
const rounds=structuredClone(changes);rounds.leave[0].end_date='2027-06-25';assert.equal((await call(true,rounds)).valid,false);console.log('PASS round limit');
await db.exec(`update bidders set leave_slot_allowance=8 where id='${id(11)}'`);assert.equal((await call()).valid,false);await db.exec(`update bidders set leave_slot_allowance=208 where id='${id(11)}'`);console.log('PASS leave allowance');
await db.exec(`set test.uid='${id(111)}';set test.email='bidder@example.test'`);assert.equal((await call()).valid,false);await assert.rejects(()=>snap());console.log('PASS member denied');
await db.exec(`set test.uid='${id(112)}';set test.email='intake@example.test'`);assert.equal((await call()).valid,false);console.log('PASS intake cross-area denied');
await db.exec(`set test.uid='${id(110)}';set test.email='admin@example.test'`);
await db.exec('set role authenticated');
const saved=await call(false);await db.exec('reset role');assert.equal(saved.saved,true);assert.equal(saved.snapshot.assignment.fatigue_group,'B');assert.equal(saved.snapshot.leave[1].status,'pending');assert.equal((await db.query('select count(*) n from leave_slots where source_leave_request_id=$1',[id(31)])).rows[0].n,0);assert.equal((await db.query('select count(*) n from leave_slots where source_leave_request_id=$1',[id(30)])).rows[0].n,2);console.log('PASS durable RDO/leave save, approved slots and pending status');
assert.equal((await call()).valid,false);console.log('PASS stale snapshot rejected');


assert.equal((await db.query("select has_function_privilege('anon','public.edit_admin_bidder(integer,uuid,jsonb,jsonb,boolean)','EXECUTE') allowed")).rows[0].allowed,false);
assert.equal((await db.query("select has_function_privilege('authenticated','private.save_bidder_editor(integer,uuid,jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
console.log('PASS public/private function execution permissions');
await db.exec('reset role');
await db.exec(`insert into leave_requests(id,bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date) values('${id(32)}','${id(1)}','${id(11)}',3,1,'denied','2027-08-02','2027-08-03')`);
expected=await snap();
changes.leave.push({id:id(32),start_date:'2027-08-04',end_date:'2027-08-05'});
assert.equal((await call(false)).saved,true);
assert.equal((await db.query('select count(*) n from leave_request_dates where leave_request_id=$1',[id(32)])).rows[0].n,2);
assert.equal((await db.query('select count(*) n from leave_slots where source_leave_request_id=$1',[id(32)])).rows[0].n,0);
console.log('PASS historical date details rebuilt without allocating slots');
await db.close();
