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
