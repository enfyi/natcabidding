import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');

const totalsStart = source.indexOf('function isGhostLeaveItem(');
const totalsEnd = source.indexOf('function leaveItemChargedDays(', totalsStart);
assert.ok(totalsStart >= 0 && totalsEnd > totalsStart, 'Ghost leave capacity helpers were found');

const people = [
  { initials: 'AA', area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 80, ghostBidder: false },
  { initials: 'GH', area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 80, ghostBidder: true },
  { initials: 'GL', area: 'Area A', bidAs: 'GL', leaveSlotAllowance: 80, ghostBidder: false },
];
const committed = [
  { initials: 'AA', area: 'Area A', bidAs: 'CPC', status: 'Approved', days: 3 },
  { initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Approved', days: 5, ghostBid: true },
  { initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Pending', days: 4 },
  { initials: 'GL', area: 'Area A', bidAs: 'GL', status: 'Approved', days: 5 },
];
const totalsContext = {
  LEAVE_SLOT_HOURS_PER_DAY: 8,
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
  withLeaveReadCache: (callback) => callback(),
  formatRoundedUpLeaveDays: (days) => String(Math.ceil(days)),
};
vm.createContext(totalsContext);
vm.runInContext(source.slice(totalsStart, totalsEnd), totalsContext);

assert.equal(totalsContext.areaLeaveSlotBudget('Area A', 'cpc'), 80, 'Ghost and GL allowances do not increase the CPC total');
assert.equal(totalsContext.areaLeaveSlotUsed('Area A', 'cpc'), 1, 'Ghost and GL leave do not consume the aggregate CPC balance');
assert.equal(totalsContext.areaLeaveSlotUsedDays('Area A', 'cpc'), 3, 'Ghost and GL leave days do not reduce remaining CPC days');
assert.equal(
  totalsContext.leaveAreaCapacityMessageWithCache('Area A', 'GL', [{ initials: 'GL', area: 'Area A', bidAs: 'GL', days: 20 }]),
  '',
  'GL leave remains available while the area has any CPC balance',
);
committed.push({ initials: 'AB', area: 'Area A', bidAs: 'CPC', status: 'Approved', days: 7 });
assert.match(
  totalsContext.leaveAreaCapacityMessageWithCache('Area A', 'GL'),
  /leave balance is exhausted/,
  'GL leave stops when the non-GL area balance is exhausted',
);

const overlayStart = source.indexOf('function showInitialsInVisibleSlot(');
const overlayEnd = source.indexOf('function visibleLeaveSlotDetails(', overlayStart);
assert.ok(overlayStart >= 0 && overlayEnd > overlayStart, 'Leave calendar overlay helpers were found');

const overlayContext = {
  currentUser: { initials: 'GH', area: 'Area A', ghostBidder: true },
  leaveBids: [{ initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Approved', range: 'Jan 11, 2027', ghostBid: true }],
  leaveDraftQueue: [{ initials: 'GH', area: 'Area A', bidAs: 'CPC', status: 'Pending', range: 'Jan 11, 2027', ghostBid: true }],
  intakeQueue: [
    { initials: 'GH', area: 'Area A', bidAs: 'CPC', type: 'Leave', status: 'Pending', range: 'Jan 11, 2027', ghostBid: true },
    { initials: 'GL', area: 'Area A', bidAs: 'GL', type: 'Leave', status: 'Approved', range: 'Jan 11, 2027' },
  ],
  leaveSlotMap: () => ({}),
  leaveSlotsForDateFromMap: () => ({ area: 'Area A', cpc: ['AA', 'BB'], dev: [], glBids: [], cpcCapacity: 3, devCapacity: 1 }),
  leaveSlotCapacityForDetails: (details, bucket) => details[`${bucket}Capacity`],
  activeLeavePreviewItem: () => ({ initials: 'GH', bidAs: 'CPC', range: 'Jan 11, 2027' }),
  leaveSlotDateKeys: () => ['2027-01-11'],
  leaveDateKeysForItem: () => ['2027-01-11'],
  leaveSlotDatesForInitials: () => ['2027-01-11'],
  leaveSlotBucketForBidAs: () => 'cpc',
  currentUserBidAs: () => 'CPC',
  isGhostLeaveItem: (item) => item?.ghostBid === true,
  isGlLeaveItem: (item) => item?.bidAs === 'GL',
};
vm.createContext(overlayContext);
vm.runInContext(source.slice(overlayStart, overlayEnd), overlayContext);
const visible = overlayContext.visibleLeaveSlotDetailsFromMap('2027-01-11', 'Area A');
assert.deepEqual([...visible.cpc], ['AA', 'BB'], 'Ghost and GL leave do not change the CPC calendar capacity');
assert.deepEqual(
  JSON.parse(JSON.stringify(visible.glBids)),
  [{ initials: 'GL', status: 'Approved', label: 'GL Bid' }],
  'GL leave remains visible as an annotated calendar overlay',
);
assert.match(source, /class="gl-bid-marker"[^>]*>\*<\/span>/, 'GL calendar dates use the compact asterisk marker');

const markup = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8');
assert.match(markup, /<i class="gl-bid">\*<\/i> GL Bid/, 'The calendar legend explains the GL asterisk marker');

assert.match(source, /round >= 1 && round <= 6/);
console.log('PASS ghost and GL bidders stay outside area totals while GL uses its personal balance through Round 6');
