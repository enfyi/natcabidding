import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const helpersStart = source.indexOf('function formatRoundedUpLeaveDays(');
const helpersEnd = source.indexOf('function submittedRdoLineForInitials(', helpersStart);

assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'Leave-day formatting helpers were found');

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(helpersStart, helpersEnd), context);

assert.equal(context.formatRoundedUpLeaveDaysLabel(21.1), '22 days');
assert.equal(context.formatRoundedUpLeaveDaysLabel(21.9), '22 days');
assert.equal(context.formatRoundedUpLeaveDaysLabel(21), '21 days');
assert.equal(context.formatRoundedUpLeaveDaysLabel(1), '1 day');
assert.match(
  source,
  /setText\("\[data-leave-left-days\]", formatRoundedUpLeaveDaysLabel\(leftDays\)\)/,
  'The employee leave balance uses full-day ceiling rounding',
);

const scheduleStart = source.indexOf('function leaveHoursPerDayForLine(');
const scheduleEnd = source.indexOf('function currentUserLeaveAllowanceHours(', scheduleStart);
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'Leave schedule helpers were found');

const scheduleContext = {
  CWS_LEAVE_HOURS_PER_DAY: 10,
  LEAVE_SLOT_HOURS_PER_DAY: 8,
  lineFourTenValue: (line) => line.fourTen,
  submittedRdoLineForInitials: () => null,
  currentUser: { initials: 'AA' },
};
vm.createContext(scheduleContext);
vm.runInContext(source.slice(scheduleStart, scheduleEnd), scheduleContext);

assert.equal(scheduleContext.leaveHoursPerDayForLine({ fourTen: 'Yes' }), 10);
assert.equal(scheduleContext.leaveHoursPerDayForLine({ fourTen: 'No' }), 8);
assert.equal(scheduleContext.leaveHoursPerDayForLine(null), 8);
assert.match(
  source,
  /const hoursPerDay = leaveHoursPerDayForLine\(line\)/,
  'The intake employee summary uses the selected line schedule',
);
assert.match(
  source,
  /fourTen: savedLine\.four_ten \? "Yes" : "No"/,
  'Saved 4/10 line selections retain their schedule flag',
);

const budgetStart = source.indexOf('function leaveBidDayAllowanceForPerson(');
const budgetEnd = source.indexOf('function areaLeaveSlotUsed(', budgetStart);
assert.ok(budgetStart >= 0 && budgetEnd > budgetStart, 'Area leave budget helpers were found');

const people = [
  { initials: 'AA', area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 168 },
  { initials: 'CW', area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 211 },
  { initials: 'DV', area: 'Area A', bidAs: 'DEV', leaveSlotAllowance: 80 },
];
const budgetContext = {
  normalizeLeaveSlotAllowance: Number,
  leaveHoursPerDayForInitials: (initials) => initials === 'CW' ? 10 : 8,
  estimatedLeaveDaysFromHours: (hours, hoursPerDay) => hours / hoursPerDay,
  currentViewArea: () => 'Area A',
  bueRoster: () => people,
  isAreaLeaveBalanceExemptPerson: () => false,
  leaveSlotBucketForBidAs: (bidAs) => bidAs.toLowerCase(),
};
vm.createContext(budgetContext);
vm.runInContext(source.slice(budgetStart, budgetEnd), budgetContext);

assert.equal(
  budgetContext.areaLeaveSlotBudget('Area A', 'cpc'),
  43,
  'Area totals add 21 eight-hour days and 22 rounded-up ten-hour days',
);
assert.equal(
  budgetContext.areaLeaveSlotBudget('Area A', 'dev'),
  10,
  'Area totals remain separated by leave bucket',
);
assert.match(
  source,
  /const total = areaLeaveSlotBudget\(area, bucket\)/,
  'Capacity checks consume the employee-day total directly',
);
assert.doesNotMatch(
  source,
  /const cpcTotalDays = estimatedLeaveDaysFromHours\(cpcTotal\)/,
  'Area cards no longer divide pooled CPC hours by eight',
);

console.log('PASS employee and area leave balances use rounded per-employee bid days');
