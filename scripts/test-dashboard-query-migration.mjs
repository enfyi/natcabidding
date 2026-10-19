import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`
create schema auth; create schema private; create role anon; create role authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email','test@example.invalid')$$;
create function private.can_review_intake_year(uuid) returns boolean language sql stable as $$select current_setting('test.review',true)='yes'$$;
create table bidders(id uuid, auth_user_id uuid,email text,active boolean,area_id uuid,first_name text,last_name text,initials text,bid_role text,seniority_rank int);
create function public.current_bidder_area_id() returns uuid language sql stable as $$select area_id from bidders where auth_user_id=auth.uid()$$;
create table areas(id uuid,name text);
create table bid_years(id uuid,bid_year int);
create table rdo_lines(id uuid,line_code text);
create table leave_requests(id uuid,bid_year_id uuid,bidder_id uuid,round_number int,priority int,leave_type text,status text,requested_start_date date,requested_end_date date,charged_days int,notes text,submitted_at timestamptz,reviewed_at timestamptz,denial_reason text,created_at timestamptz);
create table leave_request_week_buckets(leave_request_id uuid,bucket_start_date date);
create table intake_submissions(id uuid,bid_year_id uuid,bidder_id uuid,area_id uuid,submission_type text,status text,round_number int,submitted_at timestamptz,reviewed_at timestamptz,reviewed_by uuid,denial_reason text,leave_request_id uuid,rdo_line_id uuid,is_ghost_bid boolean,payload jsonb,is_change boolean,original_bid jsonb,supersedes_submission_id uuid,change_source text);
grant usage on schema public,private,auth to authenticated;
grant execute on function auth.uid() to authenticated;
`);
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.query('insert into bid_years values ($1,2027),($2,2028)',[uuid(2027),uuid(2028)]);
for(let i=1;i<=3;i++) {
 await db.query('insert into areas values ($1,$2)',[uuid(100+i),`Area ${i}`]);
 await db.query("insert into bidders values ($1,$1,'test@example.invalid',true,$2,'Test',$3,$3,'CPC',1)",[uuid(i),uuid(100+i),String(i)]);
 await db.query("insert into leave_requests(id,bid_year_id,bidder_id,round_number,status,created_at) values ($1,$2,$3,1,'approved',now())",[uuid(200+i),uuid(2027),uuid(i)]);
 await db.query("insert into leave_request_week_buckets values ($1,'2027-03-21')",[uuid(200+i)]);
 await db.query("insert into intake_submissions(id,bid_year_id,bidder_id,area_id,submission_type,status,round_number,submitted_at,leave_request_id) values ($1,$2,$3,$4,'leave','approved',1,now(),$5)",[uuid(300+i),uuid(2027),uuid(i),uuid(100+i),uuid(200+i)]);
}
await db.query("update leave_requests set status='denied' where bidder_id=$1",[uuid(2)]);
await db.query('update leave_requests set round_number=2 where bidder_id=$1',[uuid(3)]);
await db.exec(await readFile(new URL('fixtures/dashboard-readers-before.sql',import.meta.url),'utf8'));
async function snapshot(actor,review,year) {
 await db.query("select set_config('test.actor',$1,false),set_config('test.review',$2,false)",[actor,review]);
 return (await db.query('select public.read_bidding_state(2027) state,(select coalesce(jsonb_agg(q order by id),\'[]\'::jsonb) from public.read_leave_intake_queue($1) q) queue',[year])).rows[0];
}
const cases=[[uuid(1),'no',2027],[uuid(2),'no',null],[uuid(3),'yes',2027],[uuid(1),'yes',2028]];
const before=[];
for(const c of cases) before.push(await snapshot(...c));
const migration=await readFile(new URL('../supabase/migrations/20261008075142_dashboard_reload_query_performance.sql',import.meta.url),'utf8');
await db.exec(migration);
await db.exec(migration); // safe to reapply
for(let i=0;i<cases.length;i++) {
 assert.deepEqual(await snapshot(...cases[i]),before[i],'Existing visibility and response fields remain identical');
 const combined=(await db.query('select public.read_leave_intake_queue_with_weeks($1) data',[cases[i][2]])).rows[0].data;
 assert.equal(combined.length,before[i].queue.length);
 for(const row of combined) {
  assert.deepEqual(row.weekBucketStarts,row.round_number===1 && ['pending','approved'].includes(row.status)?['2027-03-21']:[]);
  const {weekBucketStarts,...original}=row;
  assert.deepEqual(original,before[i].queue.find(q=>q.id===row.id));
 }
}
await db.exec("select set_config('test.actor','',false)");
await assert.rejects(db.query('select public.read_leave_intake_queue_with_weeks(2027)'),/Authentication required/);
const permissions=(await db.query("select has_function_privilege('anon','public.read_leave_intake_queue_with_weeks(integer)','execute') anon, has_function_privilege('authenticated','public.read_leave_intake_queue_with_weeks(integer)','execute') member")).rows[0];
assert.equal(permissions.anon,false); assert.equal(permissions.member,true);
await db.exec(`select set_config('test.actor','${uuid(1)}',false); select set_config('test.review','no',false); set role authenticated;`);
assert.equal((await db.query('select public.read_leave_intake_queue_with_weeks(2027) data')).rows[0].data.length,1);
await db.close();
console.log('PASS isolated Postgres migration preserves reader outputs/access, combines buckets, rejects anonymous calls, and is idempotent.');
