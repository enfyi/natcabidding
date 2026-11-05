import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
// Stop immediately after the real capacity check so these tests do not need
// DOM rendering or persistence. Passing capacity must reach this sentinel.
const passed = new Error('Passed area capacity');
let selected = ['work-1', 'holiday', 'work-2'];
let budget = 2;
let status = '';
const c = vm.createContext({
  BID_YEAR: 2027, currentUser: { initials: 'TB', area: 'Area A', bidAs: 'CPC' },
  currentUserBidAs: () => c.currentUser.bidAs,
  currentRoundNumber: () => 4, openAreaBidRound: () => 4,
  leaveReplacementRequestId: '', leaveDraftQueue: [],
  leaveBidWindowErrorMessage: () => '',
  leaveBuilderValues: () => ({ range: selected.join(','), notes: '' }),
  usesIndividualLeaveDateSelection: () => true,
  leaveBuilderDateKeys: () => selected,
  formatIndividualLeaveDates: keys => keys.join(','),
  datesInLeaveRange: range => range ? range.split(',') : [],
  invalidLeaveYearDateKeys: () => [], matchesRemovedLeaveDates: () => false,
  isRdoDateForInitials: key => key === 'rdo', isHolidayDate: key => key === 'holiday',
  setLeaveDaysInput: () => {}, setLeaveBuilderStatus: message => { status = message; },
  leaveRoundUsageForInitials: () => [], leaveDraftTotalDays: () => 0,
  currentRoundLeaveLimit: () => 100, leaveProjectedChargedDays: () => 0,
  leaveAllowanceLimitForRound: () => 100, leaveOverAccrualAllowed: () => false,
  bidderLeaveAvailabilityMessage: () => '',
  activeLeaveItemsForInitials: () => { throw passed; },
  manualLeaveValidationMessage: () => '',
  contiguousLeaveDateRanges: keys => [keys],
  // A successful manual check proceeds to building the request.
  formatDateTime: () => { throw passed; },
  withLeaveReadCache: read => read(),
  areaLeaveSlotBudget: () => budget,
  areaCommittedLeaveItems: () => [],
  isAreaLeaveBalanceExemptItem: item => item.bidAs === 'GL' || item.ghostBid,
  leaveItemArea: item => item.area, leaveItemBidAs: item => item.bidAs,
  leaveSlotBucketForBidAs: role => role === 'DEV' ? 'dev' : 'cpc',
});
vm.runInContext([
  'leaveDateKeysForItem', 'chargeableLeaveDateKeys', 'chargeableLeaveDatesForInitials',
  'leaveSlotDateKeys', 'leaveItemAreaUsedDays', 'areaLeaveSlotUsedDays',
  'formatRoundedUpLeaveDays', 'leaveAreaCapacityMessage', 'leaveAreaCapacityMessageWithCache',
  'prepareManualLeaveEntries', 'addOrUpdateLeaveSubmission',
].map(extract).join('\n'), c);
const panel = { querySelector: () => ({ value: '4' }) };
const manual = () => c.prepareManualLeaveEntries(panel, c.currentUser, 'Area A',
  [selected.slice(0, -1), selected.slice(-1)].filter(keys => keys.length).map(keys => ({ range: keys.join(',') })));
const bidder = () => c.addOrUpdateLeaveSubmission();

for (const role of ['CPC', 'DEV']) {
  c.currentUser.bidAs = role;
  budget = 2;
  status = '';
  bidder();
  assert.match(status, /leave balance is exhausted/, `${role} preview counts all three workdays, including holiday`);
  assert.throws(manual, /leave balance is exhausted/, `${role} manual batch combines all selected dates`);
  budget = 3;
  assert.throws(bidder, error => error === passed, 'Exact remaining capacity is allowed');
  assert.throws(manual, error => error === passed, 'Exact capacity is allowed for manual entry');

  c.leaveDraftQueue = [{ area: 'Area A', bidAs: role, initials: 'TB', dateKeys: ['draft-day'] }];
  status = '';
  bidder();
  assert.match(status, /leave balance is exhausted/, 'Preview includes previously queued dates');
  c.leaveDraftQueue = [];
}
selected = ['work-1', 'rdo', 'holiday', 'work-2'];
assert.throws(manual, error => error === passed, 'Manual selection excludes RDOs from area usage');
selected = ['work-1'];
budget = 0;
status = '';
bidder();
assert.match(status, /leave balance is exhausted/);
assert.throws(manual, /leave balance is exhausted/);
c.currentUser.ghostBidder = true;
for (const role of ['CPC', 'DEV', 'GL']) {
  c.currentUser.bidAs = role;
  budget = 0;
  status = '';
  bidder();
  assert.match(status, /leave balance is exhausted/, `${role} ghost bidder blocked at zero`);
  assert.throws(manual, /leave balance is exhausted/, `${role} manual ghost bid blocked at zero`);
  budget = 1;
  selected = ['work-1', 'holiday', 'work-2'];
  assert.throws(bidder, error => error === passed, 'Ghost selection does not consume the positive balance');
  assert.throws(manual, error => error === passed, 'Manual ghost selection does not consume the positive balance');
}
assert.doesNotMatch(source, /ghostBidder\s*\?\s*""\s*:\s*leaveAreaCapacityMessage/,
  'Preview, preflight and final submission must all check ghost bidders');
console.log('PASS area entry checks include ghost bidders at zero while retaining non-consuming behavior with positive capacity');
