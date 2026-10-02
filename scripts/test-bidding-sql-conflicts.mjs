const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../database/', import.meta.url));
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email',current_setting('test.email',true))$$;`);
for(const file of ['schema.sql','seed.sql','ghost_bidding.sql','transactional_bidding.sql','high_priority_bidding_fixes.sql','rdo_line_eligibility.sql','leave_submission_preflight.sql','resolve_bidding_sql_conflicts.sql','holiday_leave_round_rules.sql','member_leave_request_management.sql','member_leave_request_replacement.sql','reject_unchanged_leave_rebid.sql','admin_leave_request_edit.sql','admin_bidder_editor.sql','round_one_flexible_week_buckets.sql','round_two_three_rdo_limits.sql','round_four_holiday_allowances.sql','holiday_slot_reservations.sql']) {
 let sql=fs.readFileSync(root+file,'utf8').replaceAll('create extension if not exists pgcrypto;','').replaceAll('create extension if not exists pgcrypto with schema extensions;','');
 try {await db.exec(sql); console.log('PASS',file)} catch(e) {console.error('FAIL',file,e.message,e.where||'');process.exit(1)}
}
{
 for(const file of ['20260927043000_round_four_holiday_credit_compat.sql','20260927043500_round_four_holiday_credit_submitter_fix.sql','20260928040000_allow_rdo_no_fatigue_preference.sql','20260930142036_gl_independent_leave_balance.sql','20261001231620_gl_shared_rdo_lines.sql','20261002000006_prevent_gl_leave_slot_consumption.sql','20261002015357_ghost_leave_requires_available_slots.sql']) {
  const migration=fileURLToPath(new URL(`../supabase/migrations/${file}`, import.meta.url));
  const sql=fs.readFileSync(migration,'utf8');
  try {await db.exec(sql); console.log('PASS',file)} catch(e) {console.error('FAIL',file,e.message,e.where||'');process.exit(1)}
 }
}
const year=(await db.query('select id from bid_years where bid_year=2027')).rows[0].id;
const mismatchedLines=(await db.query(`select count(*)::integer as total from rdo_lines line
  where line.bid_year_id=$1 and private.rdo_count_for_line(line.id) in (2,3)
    and line.four_ten is distinct from (private.rdo_count_for_line(line.id)=3)`,[year])).rows[0].total;
if(mismatchedLines) throw new Error(`${mismatchedLines} existing RDO lines still have the wrong 4/10 flag`);
const sevenDateSpan=(await db.query(`select private.round_one_week_bucket_starts(
 array['2027-06-16','2027-06-22']::date[])::text as starts`)).rows[0].starts;
if(sevenDateSpan!=='{2027-06-16}') throw new Error('Wednesday through Tuesday did not fit one bid week');
const bidder=(await db.query("select id,area_id from bidders where initials='SH'")).rows[0];
const line=(await db.query("select id,line_code from rdo_lines where bid_year_id=$1 and area_id=$2 and line_type='CPC' and status='open' limit 1",[year,bidder.area_id])).rows[0];
if(!line) throw new Error('No open CPC line');
await db.exec(`update bidders set auth_user_id='00000000-0000-0000-0000-000000000111', leave_slot_allowance=208 where id='${bidder.id}'; set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
const rdo=(fatigueGroup='A')=>db.query('select public.submit_rdo_bid(2027,$1,$2,true,false,\'No\',1)',[line.line_code,fatigueGroup]);
try {await rdo();throw new Error('RDO strict window unexpectedly passed')} catch(e) {if(!e.message.includes('bidding window')) throw e;console.log('PASS strict RDO window rejects')}
await db.exec(`insert into bid_year_settings(bid_year_id,enforce_bid_windows,test_bid_round) values('${year}',false,1) on conflict (bid_year_id) do update set enforce_bid_windows=false,test_bid_round=1`);
await rdo(null);
const noPreference=(await db.query(`select payload->>'fatigueGroup' as fatigue_group
  from intake_submissions where bidder_id=$1 and submission_type='rdo' and status='pending'`,[bidder.id])).rows[0];
if(!noPreference || noPreference.fatigue_group!==null) throw new Error('No-preference RDO did not keep the fatigue group blank');
console.log('PASS RDO testing bypass submits with no fatigue preference');
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
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${bidder.area_id}','2027-05-31','cpc','HOLIDAY-1'),
       ('${year}','${bidder.area_id}','2027-06-01','cpc','IN-LIEU-1');
 set test.uid='${holidayAuth}'; set test.email='holiday@example.test';
 update bid_year_settings set test_bid_round=2 where bid_year_id='${year}';`);
const holidayResult=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-05-31',end_date:'2027-06-01',round:2,rdo_line_code:'HOLIDAY-TEST'}])])).rows[0].result;
if(holidayResult.charged_days!==2) throw new Error('Round 2 holiday and in-lieu dates did not count as two charged days');
const holidayRequest=(await db.query(`select id,charged_days from leave_requests where bidder_id=$1 and round_number=2`,[holidayBidder])).rows[0];
if(holidayRequest.charged_days!==2) throw new Error('Stored Round 2 charged days differ from submission');
const holidayFlags=(await db.query('select charged from leave_request_dates where leave_request_id=$1 order by leave_date',[holidayRequest.id])).rows;
if(holidayFlags.length!==2 || holidayFlags.some(row=>!row.charged)) throw new Error('Holiday dates were not stored as charged');
const heldHolidaySlots=(await db.query(`select slot_date::text as slot_date,slot_initials,status
  from leave_slots where source_leave_request_id=$1 order by slot_date`,[holidayRequest.id])).rows;
if(heldHolidaySlots.length!==2 || heldHolidaySlots.some(row=>row.slot_initials!=='HT' || row.status!=='held'))
  throw new Error('Pending holiday and in-lieu bids did not hold visible daily slots');
console.log('PASS Round 2 holiday and in-lieu dates charge hours/days and hold visible slots');
await db.exec(`set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
await db.query('select public.review_bidding_submission($1,\'approved\')',[holidayResult.submission_ids[0]]);
const approvedHolidaySlots=(await db.query(`select count(*)::integer as used
  from leave_slots where source_leave_request_id=$1 and slot_initials='HT' and status='approved'`,[holidayRequest.id])).rows[0].used;
if(approvedHolidaySlots!==2) throw new Error('Approval did not retain the holiday slots and initials');
console.log('PASS holiday approval keeps initials in two consumed daily slots');
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
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${bidder.area_id}','2027-01-18','cpc','ROUND1-HOLIDAY');
 set test.uid='${roundOneAuth}'; set test.email='round-one@example.test';
 update bid_year_settings set test_bid_round=1 where bid_year_id='${year}';`);
const roundOneHoliday=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-01-18',end_date:'2027-01-18',round:1,rdo_line_code:'HOLIDAY-TEST'}])])).rows[0].result;
if(roundOneHoliday.charged_days!==1) throw new Error('Round 1 holiday did not use one leave day');
const roundOneHolidaySlot=(await db.query(`select slot_initials,status from leave_slots
  where source_leave_request_id=(select id from leave_requests where bidder_id=$1 and round_number=1 limit 1)`,[roundOneBidder])).rows[0];
if(!roundOneHolidaySlot || roundOneHolidaySlot.slot_initials!=='R1' || roundOneHolidaySlot.status!=='held')
  throw new Error('Round 1 holiday did not hold a visible daily slot');
console.log('PASS Round 1 holiday uses one leave day and one visible daily slot');

const inLieuBidder='00000000-0000-0000-0000-000000000231';
const inLieuAuth='00000000-0000-0000-0000-000000000232';
const inLieuLine='00000000-0000-0000-0000-000000000233';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${inLieuBidder}','${inLieuAuth}','${bidder.area_id}','In','Lieu','IL','in-lieu@example.test','CPC',8);
 insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status)
 values('${inLieuLine}','${year}','${bidder.area_id}','IN-LIEU-TEST','CPC','IN-LIEU-TEST','open');
 insert into rdo_line_days(rdo_line_id,weekday,shift_code)
 select '${inLieuLine}',day,case when day=1 then 'RDO' else '0700' end from generate_series(0,6) day;
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${bidder.area_id}','2027-06-01','cpc','IN-LIEU-2');
 set test.uid='${inLieuAuth}'; set test.email='in-lieu@example.test';`);
await db.query('select public.submit_rdo_bid(2027,\'IN-LIEU-TEST\',\'A\',true,false,\'No\',1)');
const provisional=(await db.query("select count(*) as days from holiday_in_lieu_days where bidder_id=$1 and in_lieu_date='2027-06-01'",[inLieuBidder])).rows[0].days;
if(provisional!==1) throw new Error('Pending RDO did not create the June 1 in-lieu date');
const inLieuResult=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-06-01',end_date:'2027-06-01',round:1,rdo_line_code:'IN-LIEU-TEST'}])])).rows[0].result;
if(inLieuResult.charged_days!==1) throw new Error('Pending RDO in-lieu leave did not use one day');
const inLieuSaved=(await db.query("select d.is_holiday_in_lieu,d.charged from leave_request_dates d join leave_requests r on r.id=d.leave_request_id where r.bidder_id=$1 and d.leave_date='2027-06-01'",[inLieuBidder])).rows[0];
if(!inLieuSaved.is_holiday_in_lieu || !inLieuSaved.charged) throw new Error('Pending in-lieu date flags are incorrect');
const inLieuSlot=(await db.query(`select slot_initials,status from leave_slots
  where source_leave_request_id=(select id from leave_requests where bidder_id=$1 and round_number=1 limit 1)`,[inLieuBidder])).rows[0];
if(!inLieuSlot || inLieuSlot.slot_initials!=='IL' || inLieuSlot.status!=='held')
  throw new Error('Pending in-lieu bid did not hold a visible daily slot');
console.log('PASS pending RDO creates a charged in-lieu date with a visible daily slot');
await db.query(`update leave_request_dates set is_holiday_in_lieu=false
  where leave_request_id=(select id from leave_requests where bidder_id=$1 and round_number=1 limit 1)
    and leave_date='2027-06-01'`,[inLieuBidder]);
const releasedInLieuSlot=(await db.query(`select bidder_id,slot_initials,status,source_leave_request_id
  from leave_slots where slot_code='IN-LIEU-2'`)).rows[0];
if(releasedInLieuSlot.bidder_id || releasedInLieuSlot.slot_initials || releasedInLieuSlot.source_leave_request_id || releasedInLieuSlot.status!=='open')
  throw new Error('Removed in-lieu designation left a stale slot reservation');
console.log('PASS removing an in-lieu designation releases its held slot');

const changeBidder='00000000-0000-0000-0000-000000000241';
const changeAuth='00000000-0000-0000-0000-000000000242';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${changeBidder}','${changeAuth}','${bidder.area_id}','Change','Tester','CT','change@example.test','CPC',16);
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${bidder.area_id}','${changeBidder}',1,'${holidayLine}','rdo','pending','{"line":"HOLIDAY-TEST"}',now());
 insert into bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at,status)
 values('${year}','${changeBidder}',1,now()-interval '1 hour',now()+interval '1 hour','open');
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
await db.exec(`set test.uid='${changeAuth}'; set test.email='change@example.test';
 insert into bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at,status)
 values('${year}','${changeBidder}',1,now()-interval '1 hour',now()+interval '1 hour','open')
 on conflict (bid_year_id,bidder_id,round_number) do update
 set opens_at=excluded.opens_at,closes_at=excluded.closes_at,status=excluded.status;`);
await db.query('select public.cancel_own_leave_request($1)',[newRequest.id]);
try {
  await submitChangeDate('2027-07-16');
  throw new Error('Removed date was accepted in a new batch');
} catch(error) {if(!error.message.includes('same dates')) throw error;}
await submitChangeDate('2027-07-17');
console.log('PASS unchanged replacement and removed-then-rebid dates are rejected');

const flexibleBidder='00000000-0000-0000-0000-000000000251';
const flexibleAuth='00000000-0000-0000-0000-000000000252';
const flexibleLine='00000000-0000-0000-0000-000000000253';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${flexibleBidder}','${flexibleAuth}','${bidder.area_id}','Flexible','Tester','FT','flexible@example.test','CPC',208);
 insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status)
 values('${flexibleLine}','${year}','${bidder.area_id}','FLEX-WEEK','CPC','F/S','open');
 insert into rdo_line_days(rdo_line_id,weekday,shift_code)
 select '${flexibleLine}',weekday,case when weekday in (5,6) then 'RDO' else '0700' end
 from generate_series(0,6) weekday;
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${bidder.area_id}','${flexibleBidder}',1,'${flexibleLine}','rdo','pending','{"line":"FLEX-WEEK"}',now());
 insert into bid_windows(bid_year_id,bidder_id,round_number,opens_at,closes_at,status)
 values('${year}','${flexibleBidder}',1,now()-interval '1 hour',now()+interval '1 hour','open');
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 select '${year}','${bidder.area_id}',selected_date,'cpc','FLEX-' || selected_date::text
 from unnest(array['2027-06-07','2027-06-08','2027-06-10','2027-06-13','2027-06-20','2027-07-01']::date[]) selected_date
 on conflict do nothing;
 update bid_year_settings set test_bid_round=1 where bid_year_id='${year}';
 set test.uid='${flexibleAuth}'; set test.email='flexible@example.test';`);
const submitFlexibleDate=async(date)=>db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
  [JSON.stringify([{start_date:date,end_date:date,round:1,rdo_line_code:'FLEX-WEEK'}])]);
await submitFlexibleDate('2027-06-10');
await submitFlexibleDate('2027-06-07');
await submitFlexibleDate('2027-06-08');
await submitFlexibleDate('2027-06-13');
const flexibleBuckets=(await db.query(`select distinct bucket.bucket_start_date::text as start_date
 from leave_request_week_buckets bucket join leave_requests request on request.id=bucket.leave_request_id
 where request.bidder_id=$1 and request.status='pending' order by start_date`,[flexibleBidder])).rows;
if(flexibleBuckets.length!==1 || flexibleBuckets[0].start_date!=='2027-06-07')
  throw new Error('Earlier and skipped dates did not reanchor to one Monday-Sunday bucket');
const mislinked=(await db.query(`select count(*)::integer as total from leave_request_dates day
 join leave_requests request on request.id=day.leave_request_id
 left join leave_request_week_buckets bucket on bucket.id=day.week_bucket_id
 where request.bidder_id=$1 and request.status='pending'
   and (bucket.id is null or day.leave_date not between bucket.bucket_start_date and bucket.bucket_end_date)`,[flexibleBidder])).rows[0].total;
if(mislinked) throw new Error('Reanchored dates lost their saved week bucket links');
await submitFlexibleDate('2027-06-20');
const twoBuckets=(await db.query(`select count(distinct bucket.bucket_start_date)::integer as total
 from leave_request_week_buckets bucket join leave_requests request on request.id=bucket.leave_request_id
 where request.bidder_id=$1 and request.status='pending'`,[flexibleBidder])).rows[0].total;
if(twoBuckets!==2) throw new Error('A Sunday outside the first seven-date span did not use a second week');
try {
  await submitFlexibleDate('2027-07-01');
  throw new Error('A third Round 1 week unexpectedly passed');
} catch(error) {if(!error.message.includes('two seven-day bid weeks')) throw error;}
const mondayRequest=(await db.query(`select id from leave_requests
 where bidder_id=$1 and requested_start_date='2027-06-07' and status='pending'`,[flexibleBidder])).rows[0].id;
await db.query('select public.cancel_own_leave_request($1)',[mondayRequest]);
const afterRemoval=(await db.query(`select min(bucket.bucket_start_date)::text as first_start
 from leave_request_week_buckets bucket join leave_requests request on request.id=bucket.leave_request_id
 where request.bidder_id=$1 and request.status='pending'`,[flexibleBidder])).rows[0].first_start;
if(afterRemoval!=='2027-06-08') throw new Error('Removing the earliest bid did not move the surviving week bucket');
console.log('PASS skipped dates share a movable seven-day week and later dates use another week');

for (const fixture of [
  { initials: 'R2', bidder: '00000000-0000-0000-0000-000000000261', auth: '00000000-0000-0000-0000-000000000262', line: '00000000-0000-0000-0000-000000000263', rdos: [5, 6], round: 2, limit: 10, hours: 8, start: '2027-09-01' },
  { initials: 'R3', bidder: '00000000-0000-0000-0000-000000000271', auth: '00000000-0000-0000-0000-000000000272', line: '00000000-0000-0000-0000-000000000273', rdos: [0, 5, 6], round: 3, limit: 8, hours: 10, start: '2027-10-01' },
]) {
  const lineCode=`ROUND23-${fixture.initials}`;
  await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
    values('${fixture.bidder}','${fixture.auth}','${bidder.area_id}','Round','Limits','${fixture.initials}','${fixture.initials.toLowerCase()}@example.test','CPC',1000);
    insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status,four_ten)
    values('${fixture.line}','${year}','${bidder.area_id}','${lineCode}','CPC','TEST','open',${fixture.rdos.length===2});
    insert into rdo_line_days(rdo_line_id,weekday,shift_code)
    select '${fixture.line}',weekday,case when weekday in (${fixture.rdos.join(',')}) then 'RDO' else '0700' end
    from generate_series(0,6) weekday;
    insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
    values('${year}','${bidder.area_id}','${fixture.bidder}',1,'${fixture.line}','rdo','pending','{"line":"${lineCode}"}',now());
    set test.uid='${fixture.auth}'; set test.email='${fixture.initials.toLowerCase()}@example.test';
    update bid_year_settings set test_bid_round=${fixture.round} where bid_year_id='${year}';`);
  const count=(await db.query('select private.rdo_count_for_line($1) as n,private.leave_hours_for_line($1) as hours,private.round_two_three_limit_for_line($1) as cap',[fixture.line])).rows[0];
  if(count.n!==fixture.rdos.length || count.hours!==fixture.hours || count.cap!==fixture.limit)
    throw new Error(`${fixture.initials} RDO-derived rules are incorrect`);
  const candidateDates=[]; const firstDate=new Date(`${fixture.start}T12:00:00Z`);
  for(let i=0;i<35;i++){const date=new Date(firstDate);date.setUTCDate(date.getUTCDate()+i);candidateDates.push({date:date.toISOString().slice(0,10),rdo:fixture.rdos.includes(date.getUTCDay())});}
  const workDates=candidateDates.filter(item=>!item.rdo).map(item=>item.date);
  await db.exec(`insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
    select '${year}','${bidder.area_id}',day,'cpc','ROUND23-' || day::text
    from unnest(array[${workDates.map(day=>`'${day}'`).join(',')}]::date[]) day on conflict do nothing;`);
  const submit=async(date)=>db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',[JSON.stringify([{start_date:date,end_date:date,round:fixture.round,rdo_line_code:lineCode}])]);
  try {await submit(candidateDates.find(item=>item.rdo).date);throw new Error('RDO bid unexpectedly passed');}
  catch(error){if(!error.message.includes('RDO dates')) throw error;}
  for(const date of workDates.slice(0,fixture.limit)) await submit(date);
  try {await submit(workDates[fixture.limit]);throw new Error('Over-limit bid unexpectedly passed');}
  catch(error){if(!error.message.includes(`${fixture.limit} charged leave days`)) throw error;}
  await db.exec(`update bidders set leave_slot_allowance=${fixture.limit*fixture.hours-fixture.hours} where id='${fixture.bidder}';`);
  const nextRound=fixture.round===2?3:2;
  await db.exec(`update bid_year_settings set test_bid_round=${nextRound} where bid_year_id='${year}';`);
  try {await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',[JSON.stringify([{start_date:workDates[fixture.limit+1],end_date:workDates[fixture.limit+1],round:nextRound,rdo_line_code:lineCode}])]);throw new Error('Over-allowance bid unexpectedly passed');}
  catch(error){if(!error.message.includes('allowance')) throw error;}
  console.log(`PASS ${fixture.rdos.length} RDOs: ${fixture.limit} days, RDO rejection, and ${fixture.hours}-hour allowance`);
}

for (const fixture of [
  { initials:'F2', bidder:'00000000-0000-0000-0000-000000000281', auth:'00000000-0000-0000-0000-000000000282', line:'00000000-0000-0000-0000-000000000283', rdos:[5,6], hours:8, limit:5, start:'2027-11-01' },
  { initials:'F3', bidder:'00000000-0000-0000-0000-000000000291', auth:'00000000-0000-0000-0000-000000000292', line:'00000000-0000-0000-0000-000000000293', rdos:[0,5,6], hours:10, limit:4, start:'2027-12-01' },
]) {
  const lineCode=`ROUND4-${fixture.initials}`;
  await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
    values('${fixture.bidder}','${fixture.auth}','${bidder.area_id}','Round','Four','${fixture.initials}','${fixture.initials.toLowerCase()}@example.test','CPC',${fixture.hours*2});
    insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status,four_ten)
    values('${fixture.line}','${year}','${bidder.area_id}','${lineCode}','CPC','TEST','open',${fixture.rdos.length===3});
    insert into rdo_line_days(rdo_line_id,weekday,shift_code)
    select '${fixture.line}',weekday,case when weekday in (${fixture.rdos.join(',')}) then 'RDO' else '0700' end
    from generate_series(0,6) weekday;
    insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
    values('${year}','${bidder.area_id}','${fixture.bidder}',1,'${fixture.line}','rdo','pending','{"line":"${lineCode}"}',now());
    insert into holiday_in_lieu_days(bid_year_id,bidder_id,holiday_id,in_lieu_date)
    select '${year}','${fixture.bidder}',id,'2027-06-01' from holidays
    where bid_year_id='${year}' and holiday_date='2027-05-31' limit 1;
    insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
    values('${year}','${bidder.area_id}','2027-05-31','cpc','${fixture.initials}-HOLIDAY'),
          ('${year}','${bidder.area_id}','2027-06-01','cpc','${fixture.initials}-IN-LIEU');
    set test.uid='${fixture.auth}'; set test.email='${fixture.initials.toLowerCase()}@example.test';
    update bid_year_settings set test_bid_round=2 where bid_year_id='${year}';`);
  const submit=async(date,round)=>db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
    [JSON.stringify([{start_date:date,end_date:date,round,rdo_line_code:lineCode}])]);
  await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
    [JSON.stringify([{start_date:'2027-05-31',end_date:'2027-06-01',round:2,rdo_line_code:lineCode}])]);
  const beforeRoundFour=(await db.query('select returned_days,returned_hours,total_hours from private.round_four_allowances where bid_year_id=$1 and bidder_id=$2',[year,fixture.bidder])).rows[0];
  if(beforeRoundFour.returned_days!==2 || beforeRoundFour.returned_hours!==2*fixture.hours || beforeRoundFour.total_hours!==4*fixture.hours)
    throw new Error(`${fixture.initials} holiday and in-lieu hours were not available before Round 4`);
  await db.exec(`update bid_year_settings set test_bid_round=4 where bid_year_id='${year}';`);
  const first=new Date(`${fixture.start}T12:00:00Z`);const workDates=[];let rdoDate;
  for(let i=0;i<21;i++){const date=new Date(first);date.setUTCDate(date.getUTCDate()+i);const key=date.toISOString().slice(0,10);
    if(fixture.rdos.includes(date.getUTCDay())) rdoDate ||= key; else workDates.push(key);}
  await db.exec(`insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
    select '${year}','${bidder.area_id}',day,'cpc','ROUND4-' || day::text
    from unnest(array[${workDates.map(day=>`'${day}'`).join(',')}]::date[]) day on conflict do nothing;`);
  try {await submit(rdoDate,4);throw new Error('Round 4 RDO bid unexpectedly passed');}
  catch(error){if(!error.message.includes('RDO dates')) throw error;}
  await submit(workDates[0],4);await submit(workDates[1],4);
  try {await submit(workDates[2],4);throw new Error('Round 4 over-allowance bid unexpectedly passed');}
  catch(error){if(!error.message.includes('allowance')) throw error;}
  await db.exec(`update bidders set leave_slot_allowance=500 where id='${fixture.bidder}';`);
  for(const date of workDates.slice(2,fixture.limit)) await submit(date,4);
  try {await submit(workDates[fixture.limit],4);throw new Error('Round 4 over-limit bid unexpectedly passed');}
  catch(error){if(!error.message.includes(`${fixture.limit} charged leave days`)) throw error;}
  console.log(`PASS Round 4 ${fixture.rdos.length} RDOs: ${fixture.limit} days and ${fixture.hours}-hour holiday credits`);
}
const preparedAllowances=(await db.query(`select count(*)::integer as ready from private.round_four_allowances
  where bid_year_id=$1 and bidder_id in ('00000000-0000-0000-0000-000000000281','00000000-0000-0000-0000-000000000291')
    and rdo_line_id is not null and total_hours is not null`,[year])).rows[0].ready;
if(preparedAllowances!==2) throw new Error('Round 4 allowances were not calculated for both line types');

const ghostBidder='00000000-0000-0000-0000-000000000301';
const ghostAuth='00000000-0000-0000-0000-000000000302';
const ghostLine='00000000-0000-0000-0000-000000000303';
await db.exec(`insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,leave_slot_allowance)
 values('${ghostBidder}','${ghostAuth}','${bidder.area_id}','Ghost','Tester','GH','ghost@example.test','CPC',80);
 insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status)
 values('${ghostLine}','${year}','${bidder.area_id}','GHOST-TEST','CPC','S/S','open');
 insert into rdo_line_days(rdo_line_id,weekday,shift_code)
 select '${ghostLine}',weekday,case when weekday in (0,6) then 'RDO' else '0700' end
 from generate_series(0,6) weekday;
 insert into bidder_bid_year_settings(bid_year_id,bidder_id,is_ghost_bidder)
 values('${year}','${ghostBidder}',true);
 set test.uid='${ghostAuth}'; set test.email='ghost@example.test';
 update bid_year_settings set enforce_bid_windows=false,test_bid_round=1 where bid_year_id='${year}';`);
const ghostRdo=(await db.query("select public.submit_rdo_bid(2027,'GHOST-TEST','A',true,false,'No',1) as result")).rows[0].result;
if(!ghostRdo.is_ghost_bid) throw new Error('Ghost RDO submission was not annotated');
await db.exec(`set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
await db.query("select public.review_bidding_submission($1,'approved')",[ghostRdo.submission_id]);
const openGhostLine=(await db.query('select status,assigned_bidder_id from rdo_lines where id=$1',[ghostLine])).rows[0];
if(openGhostLine.status!=='open' || openGhostLine.assigned_bidder_id) throw new Error('Ghost Line consumed its source RDO line');
await db.exec(`set test.uid='${ghostAuth}'; set test.email='ghost@example.test';`);
await db.exec(`update rdo_lines set status='taken',assigned_bidder_id='${bidder.id}' where id='${ghostLine}';`);
try {
  await db.query("select public.submit_rdo_bid(2027,'GHOST-TEST','A',true,false,'No',1)");
  throw new Error('Ghost RDO unexpectedly accepted a taken line');
} catch (error) {
  if (!error.message.includes('already assigned')) throw error;
}
await db.exec(`update rdo_lines set status='open',assigned_bidder_id=null where id='${ghostLine}';`);
console.log('PASS Ghost RDO rejects a taken source line');
// A ghost must see an open slot at submission, but must not reserve it.
await db.exec(`delete from leave_slots where bid_year_id='${year}' and area_id='${bidder.area_id}' and slot_date='2027-09-01' and slot_group='cpc';`);
try {
  await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
    [JSON.stringify([{start_date:'2027-09-01',end_date:'2027-09-01',round:1,rdo_line_code:'GHOST-TEST'}])]);
  throw new Error('Ghost leave unexpectedly accepted a full date');
} catch (error) {
  if (!error.message.includes('No CPC leave slot is available')) throw error;
}
const ghostDateReservations=(await db.query(`select count(*)::integer as total
 from leave_request_dates d join leave_requests lr on lr.id=d.leave_request_id
 join bidders b on b.id=lr.bidder_id where lr.bid_year_id=$1 and b.area_id=$2
 and d.leave_date='2027-09-01' and d.charged and lr.status='pending'
 and not lr.is_ghost_bid and b.bid_role not in ('ADM','NB','GL','R-DEV','D-DEV','DEV','TMCIT')`,[year,bidder.area_id])).rows[0].total;
const ghostAvailableSlotCount=ghostDateReservations+1;
await db.exec(`insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code,status)
 select '${year}','${bidder.area_id}','2027-09-01','cpc','GHOST-AVAILABLE-' || n,'open' from generate_series(1,${ghostAvailableSlotCount}) n;`);
console.log('PASS Ghost leave rejects full dates');
const ghostLeave=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-09-01',end_date:'2027-09-01',round:1,rdo_line_code:'GHOST-TEST'}])])).rows[0].result;
if(!ghostLeave.is_ghost_bid) throw new Error('Ghost leave submission was not annotated');
const stillOpen=(await db.query(`select count(*)::integer as total from leave_slots where bid_year_id=$1 and area_id=$2 and slot_date='2027-09-01' and slot_group='cpc' and status='open'`,[year,bidder.area_id])).rows[0].total;
if(stillOpen!==ghostAvailableSlotCount) throw new Error('Pending ghost leave reserved its source slot');
await db.exec(`set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
await db.query("select public.review_bidding_submission($1,'approved')",[ghostLeave.submission_ids[0]]);
const ghostLeaveRequest=(await db.query('select id,status,is_ghost_bid from leave_requests where bidder_id=$1',[ghostBidder])).rows[0];
const ghostSlots=(await db.query('select count(*)::integer as total from leave_slots where source_leave_request_id=$1',[ghostLeaveRequest.id])).rows[0].total;
if(ghostLeaveRequest.status!=='approved' || !ghostLeaveRequest.is_ghost_bid || ghostSlots!==0)
  throw new Error('Ghost leave consumed area capacity or lost its annotation');
const ghostState=(await db.query('select public.read_bidding_state(2027) as state')).rows[0].state.submissions
  .filter(item=>item.initials==='GH');
if(ghostState.length!==2 || ghostState.some(item=>!item.is_ghost_bid))
  throw new Error('Ghost annotations were not exposed in bidding state');
console.log('PASS Ghost Line stays open and Ghost Leave consumes no area capacity');

const glArea='00000000-0000-0000-0000-000000000310';
const glAreaCpc='00000000-0000-0000-0000-000000000311';
const glAreaCpcAuth='00000000-0000-0000-0000-000000000315';
const glBidder='00000000-0000-0000-0000-000000000312';
const glAuth='00000000-0000-0000-0000-000000000313';
const glLine='00000000-0000-0000-0000-000000000314';
const secondGlBidder='00000000-0000-0000-0000-000000000317';
const secondGlAuth='00000000-0000-0000-0000-000000000318';
await db.exec(`insert into areas(id,code,name,display_order)
 values('${glArea}','gl-test','GL Test Area',99);
 insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,seniority_rank,leave_slot_allowance)
 values('${glAreaCpc}','${glAreaCpcAuth}','${glArea}','Area','Controller','AC','area-controller@example.test','CPC',1,16);
 insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,seniority_rank,leave_slot_allowance)
 values('${glBidder}','${glAuth}','${glArea}','Gate','Leader','GL','gl@example.test','GL',2,40);
 insert into bidders(id,auth_user_id,area_id,first_name,last_name,initials,email,bid_role,seniority_rank,leave_slot_allowance)
 values('${secondGlBidder}','${secondGlAuth}','${glArea}','Second','Leader','G2','gl2@example.test','GL',3,40);
 insert into rdo_lines(id,bid_year_id,area_id,line_code,line_type,pattern,status)
 values('${glLine}','${year}','${glArea}','GL-LINE','CPC','S/S','open');
 insert into rdo_line_days(rdo_line_id,weekday,shift_code)
 select '${glLine}',weekday,'0700' from generate_series(0,6) weekday;
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${glArea}','${glBidder}',1,'${glLine}','rdo','pending','{"line":"GL-LINE"}',now());
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${glArea}','${secondGlBidder}',1,'${glLine}','rdo','pending','{"line":"GL-LINE"}',now());
 insert into intake_submissions(bid_year_id,area_id,bidder_id,round_number,rdo_line_id,submission_type,status,payload,submitted_at)
 values('${year}','${glArea}','${glAreaCpc}',1,'${glLine}','rdo','approved','{"line":"GL-LINE"}',now());
 update rdo_lines set status='taken',assigned_bidder_id='${glAreaCpc}',assigned_initials='AC' where id='${glLine}';
 insert into leave_requests(bid_year_id,bidder_id,round_number,priority,status,requested_start_date,requested_end_date,charged_days,submitted_at)
 values('${year}','${glAreaCpc}',1,1,'approved','2027-01-10','2027-01-10',1,now());
 insert into leave_slots(bid_year_id,area_id,slot_date,slot_group,slot_code)
 values('${year}','${glArea}','2027-11-01','cpc','GL-1'),
       ('${year}','${glArea}','2027-11-02','cpc','GL-2'),
       ('${year}','${glArea}','2027-11-03','cpc','GL-3'),
       ('${year}','${glArea}','2027-11-04','cpc','GL-4');
 set test.uid='${glAuth}'; set test.email='gl@example.test';`);
const sharedLine=(await db.query('select status,assigned_initials from rdo_lines where id=$1',[glLine])).rows[0];
const sharedGlAssignments=(await db.query('select public.read_public_gl_rdo_assignments(2027) as assignments')).rows[0].assignments
  .filter(item=>item.rdo_line_id===glLine);
if(sharedLine.status!=='taken' || sharedLine.assigned_initials!=='AC'
   || sharedGlAssignments.length!==2
   || sharedGlAssignments.map(item=>item.initials).sort().join(',')!=='G2,GL')
  throw new Error(`Shared RDO line did not expose one occupant and two GL overlays: ${JSON.stringify({sharedLine,sharedGlAssignments})}`);
const glBalanceBefore=(await db.query(`select total_days::text,used_days,remaining_days::text
 from private.area_leave_balance_days($1,$2,'cpc')`,[year,glArea])).rows[0];
if(Number(glBalanceBefore.total_days)!==2 || glBalanceBefore.used_days!==1 || Number(glBalanceBefore.remaining_days)!==1)
  throw new Error(`GL or area balance fixture was not calculated correctly: ${JSON.stringify(glBalanceBefore)}`);
const glSubmissionIds=[];
for(const [round,date] of [[4,'2027-11-01'],[5,'2027-11-02'],[6,'2027-11-03']]) {
  await db.exec(`update bid_year_settings set enforce_bid_windows=false,test_bid_round=${round} where bid_year_id='${year}'`);
  const submission=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
    [JSON.stringify([{start_date:date,end_date:date,round,rdo_line_code:'GL-LINE'}])])).rows[0].result;
  glSubmissionIds.push(submission.submission_ids[0]);
}
const glBalanceAfter=(await db.query(`select total_days::text,used_days,remaining_days::text
 from private.area_leave_balance_days($1,$2,'cpc')`,[year,glArea])).rows[0];
if(Number(glBalanceAfter.total_days)!==2 || glBalanceAfter.used_days!==1 || Number(glBalanceAfter.remaining_days)!==1)
  throw new Error('GL leave changed the area leave balance');
const glPersonalUsage=(await db.query(`select coalesce(sum(charged_days),0)::integer as used
 from leave_requests where bidder_id=$1 and status in ('pending','approved')`,[glBidder])).rows[0].used;
if(glPersonalUsage!==3) throw new Error('GL personal leave balance did not track Rounds 4-6');
await db.exec(`set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
await db.query("select public.review_bidding_submission($1,'approved')",[glSubmissionIds[0]]);
const glClaimedSlots=(await db.query(`select count(*)::integer as total from leave_slots slot
 join leave_requests request on request.id=slot.source_leave_request_id
 where request.bidder_id=$1`,[glBidder])).rows[0].total;
if(glClaimedSlots!==0) throw new Error('Approved GL leave consumed a daily area slot');
const publicGlSchedule=(await db.query('select public.read_public_leave_slots(2027) as schedule')).rows[0].schedule;
const publicGlDate=publicGlSchedule.find(row=>row.area_id===glArea && row.slot_date==='2027-11-01');
if(!publicGlDate || publicGlDate.cpc_open!==1 || publicGlDate.cpc_initials.length!==0
   || publicGlDate.gl_bids.length!==1 || publicGlDate.gl_bids[0].initials!=='GL'
   || publicGlDate.gl_bids[0].status!=='approved')
  throw new Error(`GL calendar overlay changed slot availability or lost its annotation: ${JSON.stringify(publicGlDate)}`);
await db.exec(`set test.uid='${glAreaCpcAuth}'; set test.email='area-controller@example.test';
 update bid_year_settings set test_bid_round=6 where bid_year_id='${year}';`);
const followingCpc=(await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb) as result',
  [JSON.stringify([{start_date:'2027-11-01',end_date:'2027-11-01',round:6,rdo_line_code:'GL-LINE'}])])).rows[0].result;
await db.exec(`set test.uid='00000000-0000-0000-0000-000000000111'; set test.email='sh@natcazla.com';`);
await db.query("select public.review_bidding_submission($1,'approved')",[followingCpc.submission_ids[0]]);
const sharedDateSlot=(await db.query(`select slot_initials,status from leave_slots
 where bid_year_id=$1 and area_id=$2 and slot_date='2027-11-01' and slot_group='cpc'`,[year,glArea])).rows[0];
if(sharedDateSlot.slot_initials!=='AC' || sharedDateSlot.status!=='approved')
  throw new Error('The CPC bidder behind the GL bidder could not claim the still-open date');
await db.exec(`set test.uid='${glAuth}'; set test.email='gl@example.test';`);
try {
  await db.query('select public.submit_leave_bid_batch(2027,$1::jsonb)',
    [JSON.stringify([{start_date:'2027-11-04',end_date:'2027-11-04',round:6,rdo_line_code:'GL-LINE'}])]);
  throw new Error('GL leave unexpectedly passed after the area balance was exhausted');
} catch(error) {
  if(!error.message.includes('leave balance is exhausted')) throw error;
}
console.log('PASS two GL bidders share one occupied RDO line, stay visible, and consume no line or leave slots');
