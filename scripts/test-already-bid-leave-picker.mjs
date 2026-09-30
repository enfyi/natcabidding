import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const picker={hidden:false,innerHTML:''};let message='';
const context={currentUser:{initials:'ME'},leaveReplacementRequestId:'',leavePickerOpen:true,leavePickerYear:2027,leavePickerMonthIndex:5,
 document:{querySelector:()=>picker},dayNames:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],monthNames:['Jan','Feb','Mar','Apr','May','Jun'],
 activeLeaveItemsForInitials:()=>[{id:'pending',dateKeys:['2027-06-07']},{id:'approved',dateKeys:['2027-06-14']}],
 submittedLeaveItemKey:i=>i.id,leaveDateKeysForItem:i=>i.dateKeys,leaveBuilderDateKeys:()=>[],
 isLeaveBuilderRangeEdge:()=>false,isBidLeaveYearDate:()=>true,isRdoDateForInitials:()=>false,
 dateKey:(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
 formatCalendarDate:k=>k,setLeaveBuilderStatus:m=>message=m};
vm.createContext(context);
for(const name of ['previouslyBidLeaveDateKeys','renderLeaveDatePicker']){
 const start=source.indexOf(`function ${name}(`);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
}
context.renderLeaveDatePicker();
assert.match(picker.innerHTML,/disabled aria-label="Jun 7, 2027: already submitted/);
assert.match(picker.innerHTML,/disabled aria-label="Jun 14, 2027: already submitted/);
assert.match(picker.innerHTML,/data-leave-picker-date="2027-06-08"/);
context.leaveReplacementRequestId='approved';context.renderLeaveDatePicker();
assert.match(picker.innerHTML,/data-leave-picker-date="2027-06-14"/,'Replacement retains its own dates');
const start=source.indexOf('function selectLeaveBuilderDate(key) {');
const guard=source.slice(start,source.indexOf('  if (isRdoDateForInitials',start));
vm.runInContext(guard+'}',context);
assert.equal(context.selectLeaveBuilderDate('2027-06-07'),false);assert.match(message,/already in your submitted/);
console.log('PASS pending/approved dates disabled, unbid dates available, replacement preserved, selection guard enforced');
