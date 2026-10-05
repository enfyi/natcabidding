import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../bidding.js',import.meta.url),'utf8');
const start=source.indexOf('async function saveIntakeOverride(');
const end=source.indexOf('\nfunction rdoRequestAwaitingApproval',start);
const item={id:'bid',type:'RDO Line',status:'Approved',line:'old',summary:'old'};
let writes=0, histories=0;
const context=vm.createContext({intakeQueue:[item],hasIntakeAccess:()=>true,supabaseState:{connected:true},captureIntakeOverrideFields:i=>{i.line='new';},saveSupabaseApprovedRdoEdit:async()=>{writes++;},refreshBiddingAfterIntakeDecision:async()=>{},renderApp(){},renderIntakeQueue(){},setPage(){},logHistory(){histories++;}});
vm.runInContext(source.slice(start,end),context);
await vm.runInContext("saveIntakeOverride('bid')",context);
assert.equal(writes,1,'Intaker saves approved edits to the database');
context.supabaseState.connected=false;item.line='old';
await vm.runInContext("saveIntakeOverride('bid')",context);
assert.equal(writes,1);assert.equal(item.line,'old');assert.equal(histories,0);
context.hasIntakeAccess=()=>false;
await vm.runInContext("saveIntakeOverride('bid')",context);
assert.equal(writes,1);assert.match(item.reviewNote,/Active intake access/);
console.log('PASS intaker approved edits persist; disconnected and unauthorized edits do not change history or local bids');
if(process.env.PGLITE_MODULE){
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
 await db.exec(`create schema private;
 create function private.can_review_intake_year(uuid) returns boolean language sql as $$select current_setting('test.intake_allowed')::boolean$$;
 create function public.update_pending_rdo_submission(submission_to_update uuid, requested_line_code text, requested_fatigue_group text, requested_flex boolean, requested_aws boolean, requested_mid text) returns boolean language plpgsql as $$
 declare actor record; submission record;
 begin
 select 'bue'::text role, '00000000-0000-0000-0000-000000000001'::uuid id into actor;
 if actor.id is null or actor.role not in ('admin', 'intake') then raise exception 'Bidding reviewer access is required.'; end if;
 select 'pending'::text status, '00000000-0000-0000-0000-000000000002'::uuid bid_year_id into submission;
 if submission.status <> 'pending' then raise exception 'Only pending bids'; end if;
 return true;
 end $$;`);
 const migration=await readFile(new URL('../database/intaker_pending_rdo_edit_access.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
 await db.exec("set test.intake_allowed='true'");
 const query="select public.update_pending_rdo_submission(null,'24','A',true,false,'No') saved";
 assert.equal((await db.query(query)).rows[0].saved,true,'Scheduled BUE intakers pass the database permission check');
 await db.exec("set test.intake_allowed='false'");
 await assert.rejects(db.query(query),/Bidding reviewer access is required/);
 await db.close();console.log('PASS database migration authorizes scheduled intakers and rejects other bidders');
}
