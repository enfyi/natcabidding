import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const names=['groupedLeaveIntakeItems','intakeItemRound','roundOneWeekKeysForDateKeys'];
const context={intakeGroupReviewState:new Map(),intakeQueue:[],leaveDateKeysForItem:(i)=>[...i.dateKeys],
 dateFromKey:(k)=>new Date(`${k}T12:00:00Z`),dateKeyFromDate:(d)=>d.toISOString().slice(0,10),
 formatIndividualLeaveDates:(keys)=>keys.join(', '),formatCalendarDate:(k)=>k};
vm.createContext(context);
vm.runInContext(names.map(n=>{const a=source.indexOf(`function ${n}(`);assert.ok(a>=0);return source.slice(a,source.indexOf('\n}',a)+2)}).join('\n'),context);
const item=(day,overrides={})=>({id:`day-${day}`,type:'Leave',area:'Area A',initials:'ME',round:1,status:'Pending',submissionBatchKey:'2027-01-01T10:00:00Z',days:1,dateKeys:[`2027-06-${day}`],...overrides});
const dates=['07','08','09','10','11','14','15','16','17','18'].map(d=>item(d));
let groups=context.groupedLeaveIntakeItems(dates);
assert.equal(groups.length,2);assert.deepEqual([...groups].map(g=>g.members.length),[5,5]);
assert.deepEqual([...groups[0].dateKeys],dates.slice(0,5).map(i=>i.dateKeys[0]));
assert.ok(!groups[0].dateKeys.includes('2027-06-12'),'Skipped dates are never included');
for(const round of [2,3,4]){
 groups=context.groupedLeaveIntakeItems(dates.map(i=>({...i,round})));
 assert.equal(groups.length,1);assert.equal(groups[0].members.length,10);
}
groups=context.groupedLeaveIntakeItems([item('07',{round:2}),item('08',{round:2,submissionBatchKey:'other'})]);assert.equal(groups.length,2);
groups=context.groupedLeaveIntakeItems([item('07'),item('08',{initials:'OTHER'}),item('09',{area:'Area B'})]);assert.equal(groups.length,3);
groups=context.groupedLeaveIntakeItems([item('07'),item('08',{status:'Approved'})]);assert.equal(groups.length,2);
groups=context.groupedLeaveIntakeItems([item('07',{dateKeys:['2027-06-07','2027-06-14']})]);assert.ok(!groups[0].members,'Legacy multiweek range keeps its existing approval');
assert.match(source,/review_leave_submission_group/);
assert.match(source,/Approve week/);assert.match(source,/Approve batch/);assert.match(source,/Approve date/);
console.log('PASS Round 1 week grouping, Rounds 2–4 batch grouping, skipped dates, separate bidders/batches/statuses, and legacy ranges');
