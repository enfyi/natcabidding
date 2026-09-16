const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../database/', import.meta.url));
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email',current_setting('test.email',true))$$;`);
for(const file of ['schema.sql','seed.sql','transactional_bidding.sql','high_priority_bidding_fixes.sql','rdo_line_eligibility.sql','leave_submission_preflight.sql','resolve_bidding_sql_conflicts.sql','holiday_leave_round_rules.sql','member_leave_request_management.sql','member_leave_request_replacement.sql','reject_unchanged_leave_rebid.sql','admin_leave_request_edit.sql']) {
 let sql=fs.readFileSync(root+file,'utf8').replaceAll('create extension if not exists pgcrypto;','').replaceAll('create extension if not exists pgcrypto with schema extensions;','');
 try {await db.exec(sql); console.log('PASS',file)} catch(e) {console.error('FAIL',file,e.message,e.where||'');process.exit(1)}
}
const year=(await db.query('select id from bid_years where bid_year=2027')).rows[0].id;
const bidder=(await db.query("select id,area_id from bidders where initials='SH'")).rows[0];
const line=(await db.query("select id,line_code from rdo_lines where bid_year_id=$1 and area_id=$2 and line_type='CPC' and status='open' limit 1",[year,bidder.area_id])).rows[0];
if(!line) throw new Error('No open CPC line');
await db.exec(`update bidders set auth_user_id='00000000-0000-0000-0000-000000000111', leave_slot_allowance=208 where id='${bidder.id}'; set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
const rdo=()=>db.query('select public.submit_rdo_bid(2027,$1,\'A\',true,false,\'No\',1)',[line.line_code]);
try {await rdo();throw new Error('RDO strict window unexpectedly passed')} catch(e) {if(!e.message.includes('bidding window')) throw e;console.log('PASS strict RDO window rejects')}
await db.exec(`insert into bid_year_settings(bid_year_id,enforce_bid_windows,test_bid_round) values('${year}',false,1) on conflict (bid_year_id) do update set enforce_bid_windows=false,test_bid_round=1`);
await rdo();console.log('PASS RDO testing bypass submits');
try {await db.query('select public.submit_rdo_bid(2027,$1,\'A\',true,false,\'No\',2)',[line.line_code]);throw new Error('Wrong test round unexpectedly passed')} catch(e) {if(!e.message.includes('Testing mode')) throw e;console.log('PASS RDO test round is enforced')}
const days=(await db.query('select weekday,is_rdo from rdo_line_days where rdo_line_id=$1 order by weekday',[line.id])).rows;
const start=new Date('2027-06-01T12:00:00Z');let first=null;
for(let i=0;i<14;i++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);const wd=d.getUTCDay();if(!days.find(x=>x.weekday===wd)?.is_rdo){first=d.toISOString().slice(0,10);break}}
await db.exec(`insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code) values('${year}','${bidder.area_id}','${first}','cpc','TEST') on conflict do nothing`);
await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',[JSON.stringify([{start_date:first,end_date:first,round:1,rdo_line_code:line.line_code}])]);
console.log('PASS leave testing bypass submits and checks daily slot');
await db.exec(`update bid_year_settings set enforce_bid_windows=true where bid_year_id='${year}'`);
try {await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',[JSON.stringify([{start_date:'2027-08-02',end_date:'2027-08-02',round:1,rdo_line_code:line.line_code}])]);throw new Error('Leave strict window unexpectedly passed')} catch(e) {if(!e.message.includes('bid window')) throw e;console.log('PASS strict leave window rejects')}
await db.exec(`update bid_year_settings set enforce_bid_windows=false where bid_year_id='${year}'`);
let pair=null;const base=new Date('2027-07-10T12:00:00Z');
for(let i=0;i<20;i++){const a=new Date(base);a.setUTCDate(a.getUTCDate()+i);const b=new Date(a);b.setUTCDate(b.getUTCDate()+1);const ar=days.find(x=>x.weekday===a.getUTCDay())?.is_rdo;const br=days.find(x=>x.weekday===b.getUTCDay())?.is_rdo;if(ar!==br){pair={start:a.toISOString().slice(0,10),end:b.toISOString().slice(0,10),work:(ar?b:a).toISOString().slice(0,10),rdo:(ar?a:b).toISOString().slice(0,10)};break}}
if(!pair) throw new Error('No RDO/work pair');
await db.exec(`delete from leave_slots where bid_year_id='${year}' and area_id='${bidder.area_id}' and slot_date='${pair.rdo}' and slot_group='cpc'; insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code) values('${year}','${bidder.area_id}','${pair.work}','cpc','TEST') on conflict do nothing`);
await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',[JSON.stringify([{start_date:pair.start,end_date:pair.end,round:1,rdo_line_code:line.line_code}])]);
const saved=(await db.query("select d.charged from leave_request_dates d join leave_requests r on r.id=d.leave_request_id where r.bidder_id=$1 and d.leave_date=$2 and r.status='pending'",[bidder.id,pair.rdo])).rows[0];
if(!saved || saved.charged) throw new Error('Pending RDO date was charged in saved request');
console.log('PASS Round 1 pending RDO is uncharged and needs no leave slot');

const holidayBidder='00000000-0000-0000-0000-000000000211';
const holidayAuth='00000000-0000-0000-0000-000000000212';
const holidayLine='00000000-0000-0000-0000-000000000213';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${holidayBidder}','${holidayAuth}','${bidder.area_id}','Holiday','Tester','HT','holiday@example.test','CPC',16);
 insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status)
 values('${holidayLine}','${year}','${bidder.area_id}','HOLIDAY-TEST','CPC','TEST','open');
 insert into rdo_line_days(rdo_line_id,weekday,shift_code)
 select '${holidayLine}',day,'0700' from generate_series(0,6) day;
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${bidder.area_id}','${holidayBidder}',1,'${holidayLine}','rdo','pending','{"line":"HOLIDAY-TEST"}',now());
 insert into holiday_in_lieu_days(bid_year_id,bidder_id,holiday_id,in_lieu_date)
 select '${year}','${holidayBidder}',id,'2027-06-01' from holidays where bid_year_id='${year}' and holiday_date='2027-05-31' limit 1;
 delete from leave_slots where bid_year_id='${year}' and area_id='${bidder.area_id}' and slot_date in ('2027-05-31','2027-06-01');
 set test.uid='${holidayAuth}'; set test.email='holiday@example.test';
 update bid_year_settings set test_bid_round=2 where bid_year_id='${year}';`);
const holidayResult=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-05-31',end_date:'2027-06-01',round:2,rdo_line_code:'HOLIDAY-TEST'}])])).rows[0].result;
if(holidayResult.charged_days!==2) throw new Error('Round 2 holiday and in-lieu dates did not count as two charged days');
const holidayRequest=(await db.query(`select id,charged_days from leave_requests where bidder_id=$1 and round_number=2`,[holidayBidder])).rows[0];
if(holidayRequest.charged_days!==2) throw new Error('Stored Round 2 charged days differ from submission');
const holidayFlags=(await db.query('select charged from leave_request_dates where leave_request_id=$1 order by leave_date',[holidayRequest.id])).rows;
if(holidayFlags.length!==2 || holidayFlags.some(row=>!row.charged)) throw new Error('Holiday dates were not stored as charged');
console.log('PASS Round 2 holiday and in-lieu dates charge hours/days without leave slots');
await db.exec(`set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
await db.query('select public.review_bidding_submission($1,\'approved\')',[holidayResult.submission_ids[0]]);
if((await db.query('select count(*) as used from leave_slots where source_leave_request_id=$1',[holidayRequest.id])).rows[0].used!==0)
  throw new Error('Approval consumed a leave slot for a holiday');
console.log('PASS holiday approval does not allocate daily leave slots');
await db.exec(`set test.uid='${holidayAuth}'; set test.email='holiday@example.test'; update bid_year_settings set test_bid_round=3 where bid_year_id='${year}';
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${bidder.area_id}','2027-06-02','cpc','HOLIDAY-TEST') on conflict do nothing;`);
try {await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
  [JSON.stringify([{start_date:'2027-06-02',end_date:'2027-06-02',round:3,rdo_line_code:'HOLIDAY-TEST'}])]);
  throw new Error('Round 3 exceeded the 16-hour allowance');
} catch(error) {if(!error.message.includes('allowance')) throw error;}
console.log('PASS Round 3 cannot reuse holiday hours before Round 4');
await db.exec(`update bid_year_settings set test_bid_round=4 where bid_year_id='${year}';
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${bidder.area_id}','2027-06-03','cpc','HOLIDAY-TEST'),
       ('${year}','${bidder.area_id}','2027-06-04','cpc','HOLIDAY-TEST') on conflict do nothing;`);
const roundFour=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-06-03',end_date:'2027-06-04',round:4,rdo_line_code:'HOLIDAY-TEST'}])])).rows[0].result;
if(roundFour.charged_days!==2) throw new Error('Round 4 did not use returned holiday allowance');
const holidaySummary=(await db.query('select leave_days_bid,holiday_related_days_bid,holiday_credit_days_available from bidder_leave_summary where bid_year_id=$1 and bidder_id=$2',[year,holidayBidder])).rows[0];
if(Number(holidaySummary.leave_days_bid)!==4 || Number(holidaySummary.holiday_related_days_bid)!==2 || Number(holidaySummary.holiday_credit_days_available)!==2)
  throw new Error('Bidder leave summary did not reflect holiday charges and Round 4 credits');
console.log('PASS Round 4 restores two holiday days as 16 additional hours');

const roundOneBidder='00000000-0000-0000-0000-000000000221';
const roundOneAuth='00000000-0000-0000-0000-000000000222';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${roundOneBidder}','${roundOneAuth}','${bidder.area_id}','Round','One','R1','round-one@example.test','CPC',8);
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${bidder.area_id}','${roundOneBidder}',1,'${holidayLine}','rdo','pending','{"line":"HOLIDAY-TEST"}',now());
 delete from leave_slots where bid_year_id='${year}' and area_id='${bidder.area_id}' and slot_date='2027-01-18';
 set test.uid='${roundOneAuth}'; set test.email='round-one@example.test';
 update bid_year_settings set test_bid_round=1 where bid_year_id='${year}';`);
const roundOneHoliday=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-01-18',end_date:'2027-01-18',round:1,rdo_line_code:'HOLIDAY-TEST'}])])).rows[0].result;
if(roundOneHoliday.charged_days!==1) throw new Error('Round 1 holiday did not use one leave day');
console.log('PASS Round 1 holiday uses one leave day without a daily slot');

const inLieuBidder='00000000-0000-0000-0000-000000000231';
const inLieuAuth='00000000-0000-0000-0000-000000000232';
const inLieuLine='00000000-0000-0000-0000-000000000233';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${inLieuBidder}','${inLieuAuth}','${bidder.area_id}','In','Lieu','IL','in-lieu@example.test','CPC',8);
 insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status)
 values('${inLieuLine}','${year}','${bidder.area_id}','IN-LIEU-TEST','CPC','IN-LIEU-TEST','open');
 insert into rdo_line_days(rdo_line_id,weekday,shift_code)
 select '${inLieuLine}',day,case when day=1 then 'RDO' else '0700' end from generate_series(0,6) day;
 set test.uid='${inLieuAuth}'; set test.email='in-lieu@example.test';`);
await db.query('select public.submit_rdo_bid(2027,\'IN-LIEU-TEST\',\'A\',true,false,\'No\',1)');
const provisional=(await db.query("select count(*) as days from holiday_in_lieu_days where bidder_id=$1 and in_lieu_date='2027-06-01'",[inLieuBidder])).rows[0].days;
if(provisional!==1) throw new Error('Pending RDO did not create the June 1 in-lieu date');
const inLieuResult=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-06-01',end_date:'2027-06-01',round:1,rdo_line_code:'IN-LIEU-TEST'}])])).rows[0].result;
if(inLieuResult.charged_days!==1) throw new Error('Pending RDO in-lieu leave did not use one day');
const inLieuSaved=(await db.query("select d.is_holiday_in_lieu,d.charged from leave_request_dates d join leave_requests r on r.id=d.leave_request_id where r.bidder_id=$1 and d.leave_date='2027-06-01'",[inLieuBidder])).rows[0];
if(!inLieuSaved.is_holiday_in_lieu || !inLieuSaved.charged) throw new Error('Pending in-lieu date flags are incorrect');
console.log('PASS pending RDO creates an in-lieu date that counts as charged leave');

const changeBidder='00000000-0000-0000-0000-000000000241';
const changeAuth='00000000-0000-0000-0000-000000000242';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${changeBidder}','${changeAuth}','${bidder.area_id}','Change','Tester','CT','change@example.test','CPC',16);
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${bidder.area_id}','${changeBidder}',1,'${holidayLine}','rdo','pending','{"line":"HOLIDAY-TEST"}',now());
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${bidder.area_id}','2027-07-01','cpc','CHANGE-1'),
       ('${year}','${bidder.area_id}','2027-07-15','cpc','CHANGE-2'),
       ('${year}','${bidder.area_id}','2027-07-16','cpc','CHANGE-3'),
       ('${year}','${bidder.area_id}','2027-07-17','cpc','CHANGE-4') on conflict do nothing;
 set test.uid='${changeAuth}'; set test.email='change@example.test';`);
const submitChangeDate=async(date)=>db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
  [JSON.stringify([{start_date:date,end_date:date,round:1,rdo_line_code:'HOLIDAY-TEST'}])]);
await submitChangeDate('2027-07-01');
await submitChangeDate('2027-07-15');
const originalChangeRequest=(await db.query("select id from leave_requests where bidder_id=$1 and requested_start_date='2027-07-01' and status='pending'",[changeBidder])).rows[0].id;
await db.query("select public.replace_own_leave_request($1,'2027-07-16','2027-07-16',null)",[originalChangeRequest]);
const changedRequests=(await db.query("select id,status,requested_start_date::text as requested_start_date from leave_requests where bidder_id=$1 order by requested_start_date",[changeBidder])).rows;
if(changedRequests.filter(row=>row.status==='pending').length!==2 || changedRequests.find(row=>row.id===originalChangeRequest)?.status!=='cancelled')
  throw new Error('Replacement did not subtract the original request');
const activeBuckets=(await db.query("select count(distinct b.bucket_start_date) as buckets from leave_request_week_buckets b join leave_requests r on r.id=b.leave_request_id where r.bidder_id=$1 and r.status='pending'",[changeBidder])).rows[0].buckets;
if(activeBuckets!==1) throw new Error('Replacement did not reuse the surviving week bucket');
const newRequest=changedRequests.find(row=>row.requested_start_date==='2027-07-16' && row.status==='pending');
try {
  await db.query("select public.replace_own_leave_request($1,'2027-07-16','2027-07-17',null)",[newRequest.id]);
  throw new Error('Over-allowance replacement unexpectedly passed');
} catch(error) {if(!error.message.includes('allowance')) throw error;}
const stillActive=(await db.query('select status,charged_days from leave_requests where id=$1',[newRequest.id])).rows[0];
if(stillActive.status!=='pending' || stillActive.charged_days!==1)
  throw new Error('Failed replacement did not restore the original request');
console.log('PASS replacement subtracts old dates and buckets; failed replacement rolls back');
try {
  await db.query("select public.replace_own_leave_request($1,'2027-07-16','2027-07-16',null)",[newRequest.id]);
  throw new Error('Unchanged replacement unexpectedly passed');
} catch(error) {if(!error.message.includes('same dates')) throw error;}
if((await db.query('select status from leave_requests where id=$1',[newRequest.id])).rows[0].status!=='pending')
  throw new Error('Unchanged replacement removed the original bid');
await db.query('select public.cancel_own_leave_request($1)',[newRequest.id]);
try {
  await submitChangeDate('2027-07-16');
  throw new Error('Removed date was accepted in a new batch');
} catch(error) {if(!error.message.includes('same dates')) throw error;}
await submitChangeDate('2027-07-17');
console.log('PASS unchanged replacement and removed-then-rebid dates are rejected');
