import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import acorn from 'next/dist/compiled/acorn/acorn.js';
const s=fs.readFileSync('bidding.js','utf8');
const ast=acorn.parse(s,{ecmaVersion:'latest'});
const declarations=ast.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration').map(n=>s.slice(n.start,n.end)).join('\n');
const context=vm.createContext({console, URLSearchParams,URL,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem:()=>{}},window:{location:{search:'',hash:'',pathname:'/bidding.html',href:'http://localhost/bidding.html'},matchMedia:()=>({matches:false}),NATCA_SUPABASE_CONFIG:{environment:'pilot',url:'https://pilot.example',publishableKey:'test'},supabase:{createClient:()=>{throw new Error('Use the mock client')}}}, document:{querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null}});
vm.runInContext(declarations,context);

context.assert=assert;
vm.runInContext(`
resetSupabaseBackedData();
assert.equal(formatDateTime(new Date(undefined)), "—");
assert.equal(formatDateTime(null), "—");
const submission = supabaseRdoSubmissionToIntakeItem({id:'trial',type:'RDO Line',status:'Approved',round:1,initials:'ZY',submittedAt:null,reviewedAt:'2026-10-01T12:00:00Z',payload:{line:'2',fatigueGroup:'A',aws:true,mid:'Yes'}});
assert.equal(submission.submittedAt,"—");
assert.equal(isLeaveSlotsFull('2027-08-23','Area A'),false,'Missing data must not be full');
assert.doesNotMatch(quickLeaveSlotTooltip('2027-08-23',null,'Area A'),/tooltip-slot-heading/);
assert.match(quickLeaveSlotTooltip('2027-08-23',null,'Area A'),/Loading leave slots/);
applyLeaveSlotScheduleFromDatabase([
 {area_name:'Area A',slot_date:'2027-08-23',cpc_capacity:3,dev_capacity:4,cpc_open:0,dev_open:0,cpc_initials:['ZY','CP','KE'],dev_initials:['DL','KM','JP','FG']},
 {area_name:'Area A',slot_date:'2027-03-08',cpc_capacity:3,dev_capacity:4,cpc_open:3,dev_open:4,cpc_initials:[],dev_initials:[]},
 {area_name:'Area A',slot_date:'2027-03-09',cpc_capacity:0,dev_capacity:0,cpc_open:0,dev_open:0,cpc_initials:[],dev_initials:[]}
],new Map());
assert.equal(isLeaveSlotsFull('2027-08-23','Area A'),true);
assert.equal(isLeaveSlotsFull('2027-03-08','Area A'),false);
assert.equal(isLeaveSlotsFull('2027-03-09','Area A'),true,'Saved zero capacity must still block leave');
assert.match(quickLeaveSlotTooltip('2027-08-23',null,'Area A'),/ZY/);
assert.match(quickLeaveSlotTooltip('2027-08-23',null,'Area A'),/FG/);
assert.match(quickLeaveSlotTooltip('2027-03-08',null,'Area A'),/C1 Open/);
const row={area_name:'Area A',slot_date:'2027-04-05',cpc_capacity:3,dev_capacity:4,cpc_open:3,dev_open:4,cpc_initials:[],dev_initials:[]};
supabaseState.client={rpc:async(name)=>{assert.equal(name,'read_public_leave_slots'); return {data:[row],error:null};}};
`,context);
await vm.runInContext('loadPublicPilotCalendar()',context);
vm.runInContext(`assert.equal(isLeaveSlotsFull('2027-04-05','Area A'),false);assert.equal(supabaseState.referenceDataLoaded,true);`,context);
console.log('PASS missing timestamp, unknown availability, saved zero capacity, booked initials, open slots, and public pilot calendar loading');
