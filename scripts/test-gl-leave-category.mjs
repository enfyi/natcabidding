import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\nfunction ', start + 10));
}
const context = vm.createContext({
  intakeQueue: [
    { type: 'RDO Line', initials: 'OG', area: 'Area A', line: '42', status: 'Approved' },
    { type: 'RDO Line', initials: 'OG', area: 'Area F', line: '42', status: 'Approved' },
    { type: 'RDO Line', initials: 'OG', area: 'Area F', line: '1', status: 'Denied' },
    { type: 'RDO Line', initials: 'CG', area: 'Area F', line: '1', status: 'Pending' },
  ],
  rdoLines: [
    { line: '42', area: 'Area A', lineType: 'CPC', pattern: 'S/S' },
    { line: '42', area: 'Area F', lineType: 'DEV', pattern: 'D-DEV' },
    { line: '1', area: 'Area F', lineType: 'CPC', pattern: 'S/S' },
  ],
  lineForArea: (line, area) => line.area === area,
  currentUser: { initials: 'OG', area: 'Area F' },
  areaLeaveSlotBudget: (_area, bucket) => bucket === 'dev' ? 10 : 0,
  areaLeaveSlotUsedDays: () => 0,
  leaveBidForItem: () => null,
  leaveApprovalDates: () => { throw new Error('GL must not populate area leave slots'); },
  isGhostLeaveItem: (item) => Boolean(item.ghostBid),
  leaveItemBidAs: (item) => item.bidAs,
});
vm.runInContext(['isCpcLine', 'leaveSlotBucketForBidAs', 'leaveApprovalBucket', 'leaveAreaCapacityMessageWithCache', 'syncApprovedLeaveItem', 'isAreaLeaveBalanceExemptPerson', 'isAreaLeaveBalanceExemptItem'].map(functionSource).join('\n'), context);
const bucket = context.leaveSlotBucketForBidAs;
assert.equal(bucket('GL', 'OG', 'Area F'), 'dev');
assert.equal(bucket('GL', 'OG', 'Area A'), 'cpc');
assert.equal(bucket('GL', 'CG', 'Area F'), 'cpc');
assert.equal(bucket('GL', 'UNKNOWN', 'Area F'), 'cpc');
assert.equal(bucket('CPC', 'OG', 'Area F'), 'cpc');
assert.equal(bucket('D-DEV', 'CG', 'Area F'), 'dev');
assert.equal(context.leaveApprovalBucket({ bidAs: 'GL', initials: 'OG', area: 'Area F' }), 'dev');
assert.equal(context.leaveAreaCapacityMessageWithCache('Area F', 'GL', [{ initials: 'OG' }]), '');
context.syncApprovedLeaveItem({ bidAs: 'GL', initials: 'OG', area: 'Area F' });
assert.equal(context.isAreaLeaveBalanceExemptPerson({ bidAs: 'GL' }), true);
assert.equal(context.isAreaLeaveBalanceExemptItem({ bidAs: 'GL', initials: 'OG' }), true);
context.intakeQueue[1].status = 'Denied';
assert.equal(bucket('GL', 'OG', 'Area F'), 'cpc');
context.intakeQueue[1].status = 'Pending';
assert.equal(bucket('GL', 'OG', 'Area F'), 'dev');
console.log('PASS GL leave follows its area-scoped DEV or CPC line without changing its GL role');

// Intake and public calendars retain the GL overlay even for a DEV line.
Object.assign(context, {
  leaveBids: [], leaveDraftQueue: [],
  leaveSlotsForDateFromMap: () => ({ cpc: [], dev: [], glBids: [], cpcCapacity: 1, devCapacity: 1 }),
  activeLeavePreviewItem: () => null,
  leaveSlotDatesForInitials: (range) => [range],
  leaveSlotDataIsLoaded: () => true,
  leaveSlotCapacityForDetails: (details, bucket) => details[`${bucket}Capacity`],
  escapeHtml: String,
  formatCalendarDate: String,
});
context.intakeQueue.push({
  type: 'Leave', initials: 'OG', area: 'Area F', bidAs: 'GL',
  status: 'Approved', range: '2027-01-11',
});
vm.runInContext(['isGlLeaveItem', 'addVisibleGlBid', 'visibleLeaveSlotDetailsFromMap', 'leaveSlotClosedCountForDetails', 'quickLeaveSlotTooltip'].map(functionSource).join('\n'), context);
const visible = context.visibleLeaveSlotDetailsFromMap('2027-01-11', 'Area F', {});
assert.equal(visible.glBids[0].initials, 'OG');
assert.equal(visible.glBids[0].label, 'GL Bid');
assert.equal(visible.dev.length, 0);
assert.equal(visible.cpc.length, 0);
const tooltip = context.quickLeaveSlotTooltip('2027-01-11', null, 'Area F', visible);
assert.match(tooltip, /GL Bid/);
assert.match(tooltip, /OG · GL Bid/);
assert.match(tooltip, /GL Bids · no slot used/);
console.log('PASS GL on a DEV line displays as GL Bid on the calendar without filling CPC or DEV slots');
