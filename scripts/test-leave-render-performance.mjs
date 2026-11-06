import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const names = new Set(['withLeaveReadCache', 'cachedLeaveRead', 'bueRoster', 'bueRosterUncached',
  'bueByInitials', 'bueByInitialsUncached', 'legalHolidayDatesForYear', 'legalHolidayDatesForYearUncached',
  'federalHolidayDatesForYear', 'federalHolidayDatesForYearUncached', 'holidayInLieuDatesForYear',
  'holidayInLieuDatesForYearUncached', 'isHolidayDate', 'isHolidayInLieuDate', 'nthWeekdayOfMonth',
  'lastWeekdayOfMonth', 'firstRdoWeekdayForInitials', 'isRdoWeekdayForInitials', 'inLieuHolidayKey']);
let rosterBuilds = 0;
const context = {
  currentUser: { initials: 'ME', area: 'Area A', firstName: 'Test', leaveSlotAllowance: 200 },
  senioritySource: Array.from({ length: 400 }, (_, i) => ({ initials: `B${i}`, rank: i + 1, area: 'Area A' })),
  seniorityEntryActive: () => true,
  rosterEntryToPerson: (entry) => { rosterBuilds++; return { ...entry }; },
  currentUserBidAs: () => 'CPC', normalizeLeaveSlotAllowance: Number,
  holidayOverrides: new Set(),
  dateKey: (year, month, day) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
  dateFromKey: (key) => new Date(`${key}T12:00:00`),
  dateKeyFromDate: (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
  rdoWeekdaysForLine: () => new Set([0,6]),
  submittedRdoLineForInitials: () => null,
};
vm.createContext(context);
vm.runInContext('let leaveReadCache = null;\n' + [...names].map((name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}',start)+2);
}).join('\n'), context);
context.rdoLineForInitials = (initials) => context.bueByInitials(initials);
const dates = Array.from({length:7}, (_, i) => {
  const d = new Date(2027,0,1+i); return context.dateKeyFromDate(d);
});
function render() { return dates.map((key) => [context.isHolidayDate(key),context.isHolidayInLieuDate(key)]); }
let start = performance.now();
const baseline = render();
const baselineMs = performance.now()-start;
const baselineBuilds = rosterBuilds;
rosterBuilds = 0;
start = performance.now();
const optimized = context.withLeaveReadCache(render);
const optimizedMs = performance.now()-start;
assert.deepEqual(optimized,baseline,'Holiday and in-lieu results remain identical');
assert.equal(rosterBuilds,400,'One roster build per synchronous render');
assert.ok(baselineBuilds > rosterBuilds*100,'Repeated per-date roster rebuilding is eliminated');
context.withLeaveReadCache(() => assert.equal(context.bueByInitials('B1').rank,2));
context.senioritySource[1].rank = 999;
context.withLeaveReadCache(() => assert.equal(context.bueByInitials('B1').rank,999));
assert.throws(() => context.withLeaveReadCache(() => { throw new Error('test'); }));
assert.equal(vm.runInContext('leaveReadCache',context),null,'Cache is cleared on failure');
console.log(`PASS one week of holiday rendering: ${baselineMs.toFixed(0)}ms → ${optimizedMs.toFixed(0)}ms; roster entries rebuilt ${baselineBuilds} → 400; edits remain fresh`);

// Exercise the actual click branches: validation, input counts and picker reads
// must share the same cache before the browser can paint the selected date.
context.leaveRangePreviewActive = false;
context.usesIndividualLeaveDateSelection = () => true;
context.selectLeaveBuilderDate = () => { render(); return true; };
context.syncMemberCalendarSelection = () => { render(); };
context.syncLeaveBuilderInputs = () => { throw new Error('Duplicate input calculation'); };
context.renderLeaveDatePicker = () => { render(); };
context.syncLeaveDatePickerSelection = () => { render(); };
context.leaveBidWindowErrorMessage = () => '';
context.event = { target: { closest: selector => selector === '.app-shell'
  ? {} : { dataset: { leaveDate: dates[0], leavePickerDate: dates[0] } } } };
for (const [marker, endMarker] of [
  ['  const leaveDateButton = event.target.closest("[data-leave-date]");', '  const calendarModeButton'],
  ['  const leavePickerDateButton = event.target.closest("[data-leave-picker-date]");', '  if (leavePickerOpen &&'],
]) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0);
  const branch = source.slice(start, source.indexOf(endMarker, start));
  const click = vm.runInContext(`(function () { ${branch} })`, context);
  for (let attempt = 0; attempt < 2; attempt++) {
    rosterBuilds = 0;
    click();
    assert.equal(rosterBuilds, 400, 'Each click builds the roster once across validation and rendering');
    assert.equal(vm.runInContext('leaveReadCache', context), null, 'Click cache never survives into the next action');
  }
}
console.log('PASS calendar and popup clicks share derived reads across validation and highlighting, without duplicate input updates');

let historyReads = 0;
context.activeLeaveItemsForInitials = () => { historyReads++; return [{ round: 4, days: historyReads }]; };
context.leaveRoundForItem = item => item.round;
for (const name of ['bidderActiveLeaveItems', 'leaveRoundUsageForInitials']) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
context.withLeaveReadCache(() => {
  context.bidderActiveLeaveItems('ME');
  context.leaveRoundUsageForInitials('ME', 4);
  assert.equal(historyReads, 1, 'Submitted-date and round checks share a history scan');
});
context.withLeaveReadCache(() => context.leaveRoundUsageForInitials('ME', 4));
assert.equal(historyReads, 2, 'Next action reads fresh bidder history');
console.log('PASS bidder history scans are shared within each click and refreshed on the next action');
