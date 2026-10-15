import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const context = {
  intakeQueue: [],
  currentUser: { initials: 'CP', area: 'A' },
  currentViewArea: () => 'A',
  currentRoundNumber: () => 4,
  isRdoDateForInitials: (key) => key === 'rdo',
  isHolidayDate: (key) => ['holiday', 'in-lieu'].includes(key),
  leaveDateKeysForItem: (item) => item.dateKeys,
  leaveRoundForItem: (item) => item.round,
  isAreaLeaveBalanceExemptItem: (item) => item.ghostBid || item.bidAs === 'GL',
  leaveItemArea: (item) => item.area,
  leaveItemBidAs: (item) => item.bidAs,
  leaveSlotBucketForBidAs: (role) => role === 'DEV' ? 'dev' : 'cpc',
  leaveBids: [
    { initials: 'CP', area: 'A', bidAs: 'CPC', round: 4, status: 'Approved', days: 1, dateKeys: ['ordinary', 'holiday', 'in-lieu', 'rdo'] },
    { initials: 'DV', area: 'A', bidAs: 'DEV', round: 5, status: 'Pending', days: 0, dateKeys: ['holiday', 'in-lieu'] },
    { area: 'A', bidAs: 'CPC', round: 1, status: 'Pending', days: 1, dateKeys: ['ordinary'] },
    { area: 'A', bidAs: 'CPC', status: 'Cancelled', dateKeys: ['ordinary'] },
    { area: 'B', bidAs: 'CPC', status: 'Approved', dateKeys: ['ordinary'] },
    { area: 'A', bidAs: 'GL', status: 'Approved', dateKeys: ['ordinary'] },
    { area: 'A', bidAs: 'CPC', ghostBid: true, status: 'Approved', dateKeys: ['ordinary'] },
  ],
};
vm.createContext(context);
for (const name of ['chargeableLeaveDateKeys', 'leaveSlotDateKeys', 'leaveCommittedItems', 'areaCommittedLeaveItems', 'leaveItemAreaUsedDays', 'areaLeaveSlotUsedDays']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
}
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 4);
assert.equal(context.areaLeaveSlotUsedDays('A', 'dev'), 2);
assert.equal(context.areaLeaveSlotUsedDays('A', 'dev', [{ area: 'A', bidAs: 'DEV', dateKeys: ['holiday', 'rdo'] }]), 3);
assert.equal(context.chargeableLeaveDateKeys(['ordinary', 'holiday', 'in-lieu', 'rdo'], 'CP', 4).length, 1, 'Personal allowance still excludes later-round holidays');
context.leaveBids[0].status = 'Cancelled';
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 1, 'Cancelling leave restores all its area days');
context.intakeQueue.push(
  { ...context.leaveBids[2], type: 'Leave', initials: 'CP' },
  { type: 'Leave', initials: 'OTHER', area: 'A', bidAs: 'CPC', round: 1, status: 'Approved', dateKeys: ['ordinary', 'holiday', 'in-lieu'] },
  { type: 'RDO Line', initials: 'OTHER', area: 'A', bidAs: 'CPC', status: 'Approved', dateKeys: ['ordinary'] },
);
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 4, 'Other bidders count and duplicate personal/intake copies count once');
context.intakeQueue[0].status = 'Cancelled';
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 3, 'Saved cancellation overrides a stale personal copy');
assert.equal(context.leaveCommittedItems().length, 5, 'Area aggregation does not add other bidders to personal leave');
console.log('PASS area bid days include holidays, exclude RDOs, and preserve bucket and bidder exemptions');

// TE's production sequence: a denied request followed by a separate approval
// on the same date. Newest-first intake order must not hide the approval.
context.leaveBids = [];
const te = { type: 'Leave', initials: 'TE', area: 'A', bidAs: 'CPC', round: 1, dateKeys: ['2027-12-23'] };
const approved = { ...te, id: 'approved-row', supabaseRequestId: 'approved-request', status: 'Approved' };
const denied = { ...te, id: 'denied-row', supabaseRequestId: 'denied-request', status: 'Denied' };
for (const queue of [[approved, denied], [denied, approved]]) {
  context.intakeQueue = queue;
  assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 1, 'A denial cannot hide a separate approval on the same date');
}
context.leaveBids = [{ ...approved }];
context.intakeQueue = [{ ...approved, status: 'Cancelled' }, denied];
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 0, 'Saved cancellation replaces the personal copy of the same request');
context.leaveBids = [{ ...te, status: 'Approved' }];
context.intakeQueue = [approved, denied];
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 1, 'An unlinked personal copy is replaced by the saved requests');
console.log('PASS same-date resubmissions retain independent decisions in either intake order');

// CWS uses ten-hour days for the personal allowance, but each selected workday
// consumes exactly one area day, independent of schedule hours.
context.leaveBids = [];
context.intakeQueue = [];
context.leaveHoursPerDayForInitials = () => 10;
const ce = { type: 'Leave', initials: 'CE', area: 'A', bidAs: 'CPC', round: 1, status: 'Approved', fourTen: 'Yes' };
context.intakeQueue = [{ ...ce, supabaseRequestId: 'ce-one', dateKeys: ['2027-06-02'] }];
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 1, 'One CE CWS workday consumes one area day');
const ceDays = Array.from({ length: 21 }, (_, index) => `workday-${index + 1}`);
context.intakeQueue = [{ ...ce, supabaseRequestId: 'ce-21', dateKeys: [...ceDays, 'rdo'] }];
assert.equal(context.areaLeaveSlotUsedDays('A', 'cpc'), 21, 'Twenty-one CE CWS workdays consume 21 area days, with no hours conversion');
assert.equal(26 - context.areaLeaveSlotUsedDays('A', 'cpc'), 5, 'CE contributes 26 area days and using 21 leaves five area days');
console.log('PASS each CE CWS workday uses exactly one area day');
