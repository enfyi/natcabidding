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
  LEAVE_SLOT_HOURS_PER_DAY: 8,
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
  48,
  'Area totals add 21 days and 27 days using eight-hour units even for CWS',
);
assert.equal(budgetContext.leaveBidDayAllowanceForPerson(people[1]), 22, 'Individual CWS allowance still divides 211 hours by ten and rounds up');
assert.equal(budgetContext.leaveBidDayAllowanceForPerson(people[0]), 21, 'Individual standard allowance still uses eight hours');
people.push(
  { initials: 'F1', area: 'Area B', bidAs: 'CPC', leaveSlotAllowance: 9 },
  { initials: 'F2', area: 'Area B', bidAs: 'CPC', leaveSlotAllowance: 9 },
);
assert.equal(budgetContext.areaLeaveSlotBudget('Area B', 'cpc'), 4, 'Round each bidder before summing, rather than rounding pooled hours');
assert.equal(
  budgetContext.areaLeaveSlotBudget('Area A', 'dev'),
  10,
  'Area totals remain separated by leave bucket',
);
assert.match(
  source,
  /const total = areaLeaveSlotBudget\(area, bucket\)/,
  'Capacity checks consume the area eight-hour budget directly',
);
assert.doesNotMatch(
  source,
  /const cpcTotalDays = estimatedLeaveDaysFromHours\(cpcTotal\)/,
  'Area cards no longer divide pooled CPC hours by eight',
);

console.log('PASS individual allowances use schedule hours and area totals sum rounded eight-hour allowances');

// CE: 208 hours on CWS permits 21 personal days and contributes 26 area days.
const ce = { initials: 'CW', area: 'Area CWS Example', bidAs: 'CPC', leaveSlotAllowance: 208 };
people.push(ce);
assert.equal(budgetContext.leaveBidDayAllowanceForPerson(ce), 21);
assert.equal(budgetContext.areaLeaveSlotBudget(ce.area, 'cpc'), 26);
const personalStart = source.indexOf('function currentUserBaseLeaveAllowanceDays(');
const personalEnd = source.indexOf('\nfunction ', personalStart + 1);
vm.runInContext(source.slice(personalStart, personalEnd), budgetContext);
budgetContext.currentUserLeaveAllowanceHours = () => 208;
budgetContext.leaveHoursPerDayForInitials = () => 10;
assert.equal(budgetContext.currentUserBaseLeaveAllowanceDays(), 21, 'The actual personal bid-limit helper retains the CWS divisor');
assert.equal(budgetContext.areaLeaveSlotBudget(ce.area, 'cpc') - budgetContext.currentUserBaseLeaveAllowanceDays(), 5);
console.log('PASS CE: 21 personal CWS days, 26 area days, and five additional area days');

// Exercise the actual allowance helpers used by date selection, submission,
// bid changes, and leave replacement, rather than only the displayed balance.
for (const name of ['leaveAllowanceLimitForRound', 'leaveAllowanceHoursForRound']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), budgetContext);
}
budgetContext.leaveHolidayCreditsForRound = round => round >= 4 ? 2 : 0;
for (const [scheduleHours, accruedHours] of [[8, 198], [10, 248]]) {
  budgetContext.currentUserLeaveAllowanceHours = () => accruedHours;
  budgetContext.leaveHoursPerDayForInitials = () => scheduleHours;
  const limit = budgetContext.leaveAllowanceLimitForRound(2);
  assert.equal(limit, 25, 'Fractional base allowance rounds up on both schedules');
  assert.ok(20 + 5 <= limit, 'A bidder with 20 days already bid can submit the final five days');
  assert.ok(20 + 6 > limit, 'The round-up does not permit a sixth day');
  assert.equal(budgetContext.leaveAllowanceHoursForRound(2), 25 * scheduleHours,
    'Hour-based bidder checks allow the same rounded-up day');
  assert.equal(budgetContext.leaveAllowanceLimitForRound(4), 27,
    'Holiday credits are added after rounding the base allowance');
  budgetContext.currentUserLeaveAllowanceHours = () => 24 * scheduleHours;
  assert.equal(budgetContext.leaveAllowanceLimitForRound(2), 24,
    'Exact whole-day allowances receive no additional day');
}
console.log('PASS bidder day/hour submission limits permit rounded-up days for standard and CWS schedules');
