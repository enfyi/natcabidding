import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');

const totalsStart = source.indexOf('function isGhostLeaveItem(');
const totalsEnd = source.indexOf('function estimatedLeaveDaysFromHours(', totalsStart);
assert.ok(totalsStart >= 0 && totalsEnd > totalsStart, 'Ghost leave capacity helpers were found');

const people = [
  { initials: 'AA', area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 80, ghostBidder: false },
  { initials: 'GH', area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 80, ghostBidder: true },
];
const committed = [
  { initials: 'AA', area: 'Area A', bidAs: 'CPC', status: 'Approved', days: 3 },
  { initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Approved', days: 5, ghostBid: true },
  { initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Pending', days: 4 },
];
const totalsContext = {
  currentUser: { initials: 'AA', area: 'Area A', bidAs: 'CPC', ghostBidder: false },
  bueRoster: () => people,
  bueByInitials: (initials) => people.find((person) => person.initials === initials),
  currentUserBidAs: () => 'CPC',
  currentViewArea: () => 'Area A',
  leaveSlotBucketForBidAs: () => 'cpc',
  normalizeLeaveSlotAllowance: Number,
  leaveCommittedItems: () => committed,
  leaveItemArea: (item) => item.area,
  leaveItemBidAs: (item) => item.bidAs,
  leaveSlotUnitsForItem: () => 1,
  leaveItemChargedDays: (item) => item.days,
};
vm.createContext(totalsContext);
vm.runInContext(source.slice(totalsStart, totalsEnd), totalsContext);

assert.equal(totalsContext.areaLeaveSlotBudget('Area A', 'cpc'), 80, 'Ghost bidder allowance does not increase the CPC total');
assert.equal(totalsContext.areaLeaveSlotUsed('Area A', 'cpc'), 1, 'Ghost leave does not consume a CPC slot');
assert.equal(totalsContext.areaLeaveSlotUsedDays('Area A', 'cpc'), 3, 'Ghost leave days do not reduce remaining CPC days');

const overlayStart = source.indexOf('function showInitialsInVisibleSlot(');
const overlayEnd = source.indexOf('function visibleLeaveSlotDetails(', overlayStart);
assert.ok(overlayStart >= 0 && overlayEnd > overlayStart, 'Leave calendar overlay helpers were found');

const overlayContext = {
  currentUser: { initials: 'GH', area: 'Area A', ghostBidder: true },
  leaveBids: [{ initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Approved', range: 'Jan 11, 2027', ghostBid: true }],
  leaveDraftQueue: [{ initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Pending', range: 'Jan 11, 2027', ghostBid: true }],
  intakeQueue: [{ initials: 'GH', area: 'Area A', bidAs: 'CPC', type: 'Leave', status: 'Pending', range: 'Jan 11, 2027', ghostBid: true }],
  leaveSlotMap: () => ({}),
  leaveSlotsForDateFromMap: () => ({ area: 'Area A', cpc: [], dev: [], cpcCapacity: 2, devCapacity: 1 }),
  leaveSlotCapacityForDetails: (details, bucket) => details[`${bucket}Capacity`],
  activeLeavePreviewItem: () => ({ initials: 'GH', bidAs: 'CPC', range: 'Jan 11, 2027' }),
  leaveSlotDateKeys: () => ['2027-01-11'],
  leaveDateKeysForItem: () => ['2027-01-11'],
  leaveSlotDatesForInitials: () => ['2027-01-11'],
  leaveSlotBucketForBidAs: () => 'cpc',
  currentUserBidAs: () => 'CPC',
  isGhostLeaveItem: () => true,
};
vm.createContext(overlayContext);
vm.runInContext(source.slice(overlayStart, overlayEnd), overlayContext);
const visible = overlayContext.visibleLeaveSlotDetailsFromMap('2027-01-11', 'Area A');
assert.deepEqual([...visible.cpc], [], 'Ghost leave is not painted into CPC calendar capacity');

console.log('PASS ghost bidders neither add CPC allowance nor consume CPC leave capacity');
