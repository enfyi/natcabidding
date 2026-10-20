import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const fn=name=>{const start=source.indexOf(`function ${name}(`); assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);};
const key='2027-06-10'; let details;
const content={innerHTML:''},board={innerHTML:''},title={textContent:''};
const sheet={querySelector:()=>content,showModal(){this.open=true;}};
const c=vm.createContext({
 extraLeaveSlotData:{},areaNameForRow:r=>r.area_name,
 extraLeaveSlotStorageKey:(date,area)=>area+'|'+date,
 formatCalendarDate:k=>k,escapeHtml:v=>String(v),
 leaveSlotsForDate:()=>details,visibleLeaveSlotDetails:()=>details,
 leaveSlotMapUncached:()=>({[key]:details}),visibleLeaveSlotDetailsFromMap:()=>details,
 dateFromKey:k=>new Date(k+'T12:00:00'),calendarHolidayKind:()=>null,
 publicState:{area:'Area A'},currentUser:{area:'Area A'},fullLeaveDates:new Set(),
 document:{querySelector:()=>sheet,getElementById:id=>id==='leave-slot-board'?board:title},
});
vm.runInContext(['applyLeaveSlotScheduleFromDatabase','leaveSlotDataIsLoaded','leaveSlotCapacityForDetails','leaveSlotOpenCountForDetails','leaveSlotClosedCountForDetails','isLeaveSlotsFull','slotRows','quickLeaveSlotTooltip','openPublicDateSheetWithCache','renderLeaveSlotBoardWithCache'].map(fn).join('\n'),c);
for (const bucket of ['cpc','dev']) {
 const row={area_name:'Area A',slot_date:key,cpc_capacity:2,dev_capacity:4,cpc_open:0,dev_open:4,cpc_initials:['AB','CD'],dev_initials:[],cpc_closed:0,dev_closed:0};
 row[bucket+'_closed']=1;
 if(bucket==='dev'){row.dev_capacity=3;row.dev_open=0;row.dev_initials=['EF','GH','IJ'];}
 c.applyLeaveSlotScheduleFromDatabase([row],new Map());
 details=c.extraLeaveSlotData['Area A|'+key];
 assert.equal(c.leaveSlotClosedCountForDetails(details,bucket),1);
 assert.equal(c.leaveSlotCapacityForDetails(details,bucket),row[bucket+'_capacity']);
 assert.equal(c.leaveSlotOpenCountForDetails(details,bucket),0);
 assert.equal(c.isLeaveSlotsFull(key,'Area A',bucket),true,'Visible closed rows must never make a full date available');
 const tooltip=c.quickLeaveSlotTooltip(key,null,'Area A',details,false);
 const expanded=c.quickLeaveSlotTooltip(key,null,'Area A',details,true);
 assert.match(tooltip,/rule-closed-slot/);assert.match(tooltip,/>Closed</);
 assert.match(expanded,/rule-closed-slot/);
 c.openPublicDateSheetWithCache({dataset:{publicLeaveDate:key}});
 assert.match(content.innerHTML,/rule-closed-slot/);assert.match(content.innerHTML,/>Closed</);
 c.renderLeaveSlotBoardWithCache({key,area:'Area A',inspectOnly:false});
 assert.match(board.innerHTML,/rule-closed-slot/);
 const capacity=row[bucket+'_capacity'];
 details[bucket+'Closed']=0;details[bucket+'Capacity']=capacity+1;details[bucket+'Open']=1;
 assert.doesNotMatch(c.quickLeaveSlotTooltip(key,null,'Area A',details),/rule-closed-slot/);
 assert.equal(c.isLeaveSlotsFull(key,'Area A',bucket),false,'Reopening restores real capacity and removes the closed display');
}
// Dates with zero active capacity still display their closed rows.
details={area:'Area A',cpc:[],dev:[],cpcCapacity:0,devCapacity:0,cpcOpen:0,devOpen:0,cpcClosed:1,devClosed:0};
c.openPublicDateSheetWithCache({dataset:{publicLeaveDate:key}});
assert.match(content.innerHTML,/CPC 1 Closed/);
assert.equal(c.leaveSlotClosedCountForDetails({},'cpc'),0,'Older/missing closed counts default safely to zero');
console.log('PASS closed-slot data mapping, desktop tooltip, expanded calendar, mobile sheet, daily board, zero capacity, and reopening without inflating availability');
