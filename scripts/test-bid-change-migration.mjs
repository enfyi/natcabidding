import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
await db.exec(`
create schema auth; create schema private; create role anon; create role authenticated;
create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000010'::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select '{"email":"test@example.invalid"}'::jsonb$$;
create table bidders(id uuid primary key, auth_user_id uuid, email text, active boolean, role text, area_id uuid, bid_role text);
create table rdo_lines(id uuid primary key, bid_year_id uuid, assigned_bidder_id uuid, assigned_initials text, status text, updated_at timestamptz, line_code text);
create table leave_requests(id uuid primary key, bid_year_id uuid, bidder_id uuid, round_number int, status text, updated_at timestamptz);
create table leave_request_dates(leave_request_id uuid, leave_date date);
create table leave_slots(source_leave_request_id uuid, slot_code text, bidder_id uuid, slot_initials text, status text, updated_at timestamptz);
create table leave_credit_events(source_leave_request_id uuid);
create table audit_events(bid_year_id uuid, area_id uuid, actor_id uuid, event_type text, entity_table text, entity_id uuid, details jsonb);
create table intake_submissions(id uuid primary key, bid_year_id uuid, bidder_id uuid, area_id uuid, submission_type text, status text, rdo_line_id uuid, payload jsonb, updated_at timestamptz, reviewed_at timestamptz, submitted_at timestamptz default now(), created_at timestamptz default now(), round_number int, leave_request_id uuid);
`)
const migration=await readFile(new URL('../database/release_approved_rdo_on_pending_change.sql', import.meta.url),'utf8')
await db.exec(migration)
await db.exec(`
insert into bidders values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000010','test@example.invalid',true,'bue','00000000-0000-0000-0000-000000000020','CPC');
insert into rdo_lines values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000002027','00000000-0000-0000-0000-000000000010','AB','taken',now(),'1'),('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000002027',null,null,'open',now(),'2');
insert into intake_submissions(id,bid_year_id,bidder_id,area_id,submission_type,status,rdo_line_id,payload,round_number) values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000002027','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','rdo','approved','00000000-0000-0000-0000-000000000001','{"fatigueGroup":"A","flex":false,"aws":false,"mid":"No"}',1);
insert into leave_requests values ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000002027','00000000-0000-0000-0000-000000000010',1,'approved',now());
insert into leave_slots values ('00000000-0000-0000-0000-000000000201','NORMAL','00000000-0000-0000-0000-000000000010','AB','approved',now());
insert into leave_credit_events values ('00000000-0000-0000-0000-000000000201');
insert into leave_request_dates values ('00000000-0000-0000-0000-000000000201','2027-02-01');
insert into intake_submissions(id,bid_year_id,bidder_id,area_id,submission_type,status,leave_request_id,payload,round_number) values ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000002027','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','leave','approved','00000000-0000-0000-0000-000000000201','{}',1);
insert into intake_submissions(id,bid_year_id,bidder_id,area_id,submission_type,status,rdo_line_id,payload,round_number) values ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000002027','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','rdo','pending','00000000-0000-0000-0000-000000000002','{"fatigueGroup":"B","flex":true,"aws":false,"mid":"No"}',1);
`)
const {rows}=await db.query('select status,is_change,payload from intake_submissions order by id')
assert.equal(rows[0].status,'expired')
assert.equal(rows[1].status,'expired')
assert.equal(rows[2].is_change,true)
assert.equal(rows[2].payload.originalBid.line,'1')
assert.equal((await db.query('select status from rdo_lines where line_code=\'1\'')).rows[0].status,'open')
assert.equal((await db.query('select status from leave_slots')).rows[0].status,'open')
assert.equal((await db.query('select count(*)::int as n from leave_credit_events')).rows[0].n,0)
assert.equal((await db.query('select status from leave_requests')).rows[0].status,'expired')
console.log('PASS full migration classifies RDO changes, retires old approvals, releases RDO and leave slots, and preserves the original bid')
await db.close()
