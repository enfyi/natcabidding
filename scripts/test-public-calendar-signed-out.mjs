import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const fn = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
let personalCalls = 0, previews = 0;
const context = vm.createContext({
  currentUser:null, leaveBids:[], leaveDraftQueue:[], intakeQueue:[],
  formatCalendarDate: key => key,
  isLegalHolidayDate: key => key === '2027-01-01',
  isHolidayDate: () => { personalCalls++; return true; },
  isHolidayInLieuDate: () => { personalCalls++; return true; },
  activeLeavePreviewItem: () => { previews++; throw Error('Public details must not read a personal preview'); },
});
vm.runInContext(['leaveSlotsForDateFromMap','visibleLeaveSlotDetailsFromMap','cachedBaseLeaveSlotDetails','cachedVisibleLeaveSlotDetails'].map(fn).join('\n'), context);
const key = '2027-01-10';
const map = { [key]:{area:'Area A',date:key,cpc:['AB'],dev:['CD'],cpcCapacity:3,devCapacity:4,cpcOpen:2,devOpen:3} };
const renderContext = { area:'Area A',slotMap:map,publicReadOnly:true,baseSlotDetails:new Map(),visibleSlotDetails:new Map() };
const base = context.cachedBaseLeaveSlotDetails(key, renderContext);
assert.equal(base.cpcOpen, 2);
const visible = context.cachedVisibleLeaveSlotDetails(key, renderContext);
assert.deepEqual([...visible.cpc], ['AB']);
assert.deepEqual([...visible.dev], ['CD']);
assert.equal(visible.holiday, false); assert.equal(visible.holidayInLieu, false);
const missing = context.visibleLeaveSlotDetailsFromMap('2027-01-01','Area A',{}, {includePrivateOverlays:false});
assert.equal(missing.holiday, true, 'Missing public dates still show legal holidays');
assert.equal(missing.holidayInLieu, false);
assert.equal(personalCalls, 0); assert.equal(previews, 0);
// The default path also tolerates no user, when an explicit area/map is supplied.
context.visibleLeaveSlotDetailsFromMap(key,'Area A',map);
assert.equal(personalCalls, 0); assert.equal(previews, 0);
context.currentUser = {initials:'AB',area:'Area A'};
context.leaveSlotsForDateFromMap(key,'Area A',map);
assert.equal(personalCalls, 2, 'Member detail defaults preserve personal holiday calculations');
personalCalls = 0;
context.visibleLeaveSlotDetailsFromMap(key,'Area A',map,{includePrivateOverlays:false});
assert.equal(personalCalls, 0, 'Public view stays independent of an existing member session');
assert.equal(previews, 0);
console.log('PASS signed-out public dates: cached/uncached details, legal holidays, slot initials/capacity, no personal reads; member holidays preserved');
