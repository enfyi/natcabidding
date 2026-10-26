import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const fn = name => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n}', start) + 2); };
const fields = {
  '[data-manual-bid-controller]': { value: 'DM' },
  '[data-manual-bid-area]': { value: 'Area B' },
  '[data-manual-leave-round]': { value: '2' },
};
const panel = { querySelector: selector => fields[selector] };
const person = { initials: 'DM', bidAs: 'CPC' };
const slots = Object.fromEntries(Array.from({length:365}, (_,i) => {
  const date = new Date(2027,0,10+i); const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return [key,{cpc:[],dev:[],cpcCapacity:2,devCapacity:1,cpcOpen:2,devOpen:1}];
}));
slots['2027-06-10'].cpcOpen=0;
let range = '';
let existing = [];
let used = [];
let active = false;
let maps = 0;
const c = vm.createContext({
  BID_YEAR:2027,currentUser:{initials:'INTAKER'},fullLeaveDates:new Set(),
  manualLeaveBatch:{key:'',entries:[]},
  manualBidPerson:()=>person,currentViewArea:()=> 'Area B',
  manualLeaveRangeValue:()=>range,
  withLeaveReadCache:read=>{const previous=active;active=true;try{return read();}finally{active=previous;}},
  leaveSlotBucketForBidAs:role=>role==='DEV'?'dev':'cpc',
  leaveSlotMap:()=>{maps++;assert.ok(active);return slots;},
  leaveSlotsForDateFromMap:(key,_area,map)=>map[key]||{},
  leaveSlotDataIsLoaded:d=>d.cpcOpen!==undefined,
  leaveSlotOpenCountForDetails:(d,b)=>d[`${b}Open`],
  isRdoDateForInitials:(key,initials)=>{assert.equal(initials,'DM');return key==='2027-06-07';},
  isHolidayDate:()=>false,
  invalidLeaveYearDateKeys:keys=>keys.filter(k=>k<'2027-01-10'||k>'2028-01-08'),
  activeLeaveItemsForInitials:()=>existing,leaveDateKeysForItem:item=>item.dateKeys,
  formatLeaveConflictDates:keys=>keys.join(', '),
  leaveRoundUsageForInitials:()=>used,leaveItemChargedDays:item=>item.days,
  leaveDayLimitForRound:()=>10,
  roundOneWeekKeysForDateKeys:keys=>keys,
  roundOneWeekKeySetForItems:items=>new Set(items.flatMap(item=>item.dateKeys)),roundOneWeekLimit:()=>2,
  leaveAreaCapacityMessage:()=>'',
  fetch:()=>{throw Error('Preflight must not access the network');},
});
vm.runInContext(['manualLeaveBatchKey','manualDatePickerState','manualLeaveDateChecks','manualLeavePreflight','manualLeaveValidationMessage','chargeableLeaveDateKeys','leaveSlotDateKeys','datesInLeaveRange','dateKey','dateKeyFromDate'].map(fn).join('\n'),c);
const state=c.manualDatePickerState(panel);state.mode='multiple';
state.dates.add('2027-06-07');state.dates.add('2027-06-10');
let result=c.manualLeavePreflight(panel);
assert.ok(result.errors.some(x=>x.includes('RDO dates')));
assert.ok(result.warnings.some(x=>x.includes('Full dates')));
assert.ok(result.summary.includes('1 of 10'));
person.bidAs='DEV';assert.ok(!c.manualLeavePreflight(panel).warnings.some(x=>x.includes('Full dates')));person.bidAs='CPC';
person.ghostBidder=true;assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('Full dates')));person.ghostBidder=false;
state.dates.clear();state.dates.add('2027-06-11');
c.manualLeaveBatch={key:state.key,entries:[{range:'Jun 12, 2027',days:1}]};used=[{days:9}];
result=c.manualLeavePreflight(panel);assert.ok(result.errors.some(x=>x.includes('bring DM to 11')));
assert.ok(result.summary.includes('11 of 10'));
existing=[{dateKeys:['2027-06-11']}];assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('Already bid')));existing=[];
state.dates.add('2027-06-12');assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('already in this batch')));
state.mode='range';range='Jun 7 - 10, 2027';assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('RDO')));
range='Jan 9, 2027';assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('Dates must stay')));
range='Jun 15, 2027';delete slots['2027-06-15'];assert.ok(c.manualLeavePreflight(panel).warnings.some(x=>x.includes('not loaded')));
state.mode='multiple';c.manualLeaveBatch={key:'',entries:[]};used=[];state.dates.clear();
for(let i=11;i<=20;i++)state.dates.add(`2027-06-${i}`);
const samples=[];maps=0;
for(let i=0;i<500;i++){const start=performance.now();c.manualLeavePreflight(panel);samples.push(performance.now()-start);}
assert.equal(maps,500,'One slot map per preflight, not one per date');
samples.sort((a,b)=>a-b);const p95=samples[Math.floor(samples.length*.95)];
assert.ok(p95<50,`Preflight p95 ${p95.toFixed(2)}ms exceeds 50ms budget`);
slots['2027-06-10'].cpcOpen=2;
state.dates.clear();state.dates.add('2027-06-10');
assert.ok(!c.manualLeavePreflight(panel).warnings.some(x=>x.includes('Full dates')), 'Slot edits are read fresh on the next check');
fields['[data-manual-leave-round]'].value='1';
const roundOneState=c.manualDatePickerState(panel);roundOneState.mode='multiple';roundOneState.dates.add('2027-06-07');roundOneState.dates.add('2027-06-08');
result=c.manualLeavePreflight(panel);
assert.ok(!result.errors.some(x=>x.includes('RDO dates')));
assert.ok(result.warnings.some(x=>x.includes('Excluded from charged days')));
fields['[data-manual-bid-area]'].value='TMU';
fields['[data-manual-leave-round]'].value='3';
const tmuState=c.manualDatePickerState(panel);tmuState.mode='multiple';tmuState.dates.add('2027-06-10');
slots['2027-06-10'].cpc=['AB'];slots['2027-06-10'].cpcCapacity=1;
slots['2027-06-10'].cpcOpen=0;
assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('Full dates')), 'TMU Round 3 rejects a one-slot day with one bidder');
slots['2027-06-10'].cpc=['AB','CD'];slots['2027-06-10'].cpcCapacity=2;
assert.ok(c.manualLeavePreflight(panel).errors.some(x=>x.includes('Full dates')), 'Grandfathered two-bidder dates remain full');
slots['2027-06-10'].cpc=[];slots['2027-06-10'].cpcCapacity=1;slots['2027-06-10'].cpcOpen=1;
assert.ok(!c.manualLeavePreflight(panel).errors.some(x=>x.includes('Full dates')), 'An unused remaining slot is available');
slots['2027-06-10'].cpcOpen=0;
fields['[data-manual-bid-area]'].value='Area B';fields['[data-manual-leave-round]'].value='2';
for (const area of ['Area A','Area B','Area C','Area D','Area E','Area F','TMU']) {
  fields['[data-manual-bid-area]'].value=area;fields['[data-manual-leave-round]'].value='4';
  const nextState=c.manualDatePickerState(panel);nextState.mode='multiple';nextState.dates.add('2027-06-10');
  for (const [occupants,capacity,open] of [[['AB','CD'],2,0],[['AB','CD','EF'],3,0],[['AB','CD','EF'],4,1],[['AB','CD','EF','GH'],4,0]]) {
    Object.assign(slots['2027-06-10'],{cpc:occupants,cpcCapacity:capacity,cpcOpen:open});
    assert.equal(c.manualLeavePreflight(panel).errors.some(x=>x.includes('Full dates')),open===0,`${area} Round 4 respects reduced, grandfathered, and holiday capacity`);
  }
}
console.log(`PASS selected-bidder RDOs, CPC/DEV capacity, ghost availability, duplicates, cumulative round limit, range entry and missing-data warnings; 500 sample-data preflights p95 ${p95.toFixed(2)}ms (excludes browser paint and live data)`);
