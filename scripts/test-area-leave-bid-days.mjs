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
