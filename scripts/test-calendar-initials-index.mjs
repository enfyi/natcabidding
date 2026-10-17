import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const fn = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const keyForDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ctx = vm.createContext({
  currentUser: { initials: 'ME', area: 'Area A' }, selectedLineId: 'MON',
  supabaseState: { connected: true },
  rdoLines: [
    { line: 'MON', area: 'Area A', week: ['D', 'RDO', 'D', 'D', 'D', 'D', 'RDO'] },
    { line: 'TUE', area: 'Area A', week: ['D', 'D', 'RDO', 'D', 'D', 'D', 'RDO'] },
    { line: 'MON', area: 'Area B', week: ['RDO', 'D', 'D', 'RDO', 'D', 'D', 'D'] },
  ],
  intakeQueue: [], leaveBids: [], leaveDraftQueue: [], preview: null,
  bueByInitials: () => ({ area: 'Area A' }),
  lineForArea: (line, area) => line.area === area,
  rdoLinesForArea: area => ctx.rdoLines.filter(line => line.area === area),
  dateFromKey: key => new Date(`${key}T12:00:00`), dateKeyFromDate: keyForDate,
  activeLeavePreviewItem: () => ctx.preview,
  isGhostLeaveItem: item => Boolean(item.ghostBid),
  isGlLeaveItem: item => item.bidAs === 'GL', currentUserBidAs: () => 'CPC',
  leaveSlotBucketForBidAs: role => role === 'DEV' ? 'dev' : 'cpc',
  leaveSlotsForDateFromMap: (key, area, map) => ({ ...map[key], area }),
});
const names = ['withLeaveReadCache', 'cachedLeaveRead', 'calendarLeaveIndex', 'buildCalendarLeaveIndex',
  'visibleLeaveSlotDetailsFromMap', 'personalLeaveDateStatus', 'datesInLeaveRange', 'leaveDateKeysForItem',
  'leaveSlotDateKeys', 'leaveSlotDatesForInitials', 'isRdoDateForInitials', 'submittedRdoLineForInitials',
  'rdoLineForInitials', 'rdoWeekdaysForLine', 'showInitialsInVisibleSlot', 'addVisibleGlBid', 'leaveSlotCapacityForDetails'];
vm.runInContext('let leaveReadCache = null;\n' + names.map(fn).join('\n'), ctx);
let lookups = 0;
const submitted = ctx.submittedRdoLineForInitials;
ctx.submittedRdoLineForInitials = initials => { lookups++; return submitted(initials); };
const range = 'Jun 1 - Jun 7, 2027';
ctx.leaveBids = [{ range, status: 'Approved', bidAs: 'CPC' }];
ctx.leaveDraftQueue = [{ dateKeys: ['2027-06-02', '2027-06-03'], bidAs: 'DEV' }];
ctx.preview = { dateKeys: ['2027-06-04'], bidAs: 'GL' };
ctx.intakeQueue = [
  { type: 'RDO Line', initials: 'ME', area: 'Area A', line: 'MON', status: 'Pending' },
  { type: 'RDO Line', initials: 'XX', area: 'Area B', line: 'MON', status: 'Approved' },
  ...Array.from({ length: 200 }, (_, i) => ({ type: 'Leave', initials: `B${i}`, area: 'Area A',
    range, status: i % 2 ? 'Pending' : 'Approved', bidAs: i % 3 ? 'CPC' : 'DEV' })),
  { type: 'Leave', initials: 'GL', area: 'Area A', range, status: 'Approved', bidAs: 'GL' },
  { type: 'Leave', initials: 'GH', area: 'Area A', range, status: 'Approved', ghostBid: true },
  { type: 'Leave', initials: 'XX', area: 'Area B', range, status: 'Pending' },
  { type: 'Leave', initials: 'ME', area: 'Area A', range, status: 'Pending' },
  { type: 'Leave', initials: 'NO', area: 'Area A', range, status: 'Denied' },
];
const dates = Array.from({ length: 365 }, (_, i) => keyForDate(new Date(2027, 0, i + 1)));
const map = Object.fromEntries(dates.map(key => [key, {
  cpc: ['BASE'], dev: [], glBids: [], cpcCapacity: 3, devCapacity: 4,
}]));
const read = (key, area, privateOverlays, calendarIndex) => ctx.visibleLeaveSlotDetailsFromMap(key, area, map,
  { includePrivateOverlays: privateOverlays, calendarIndex });
const plain = value => JSON.parse(JSON.stringify(value));
let baselineLookups, optimizedLookups, baselineMs, optimizedMs;
for (const [area, privateOverlays, personal] of [
  ['Area A', true, true], ['Area A', false, false], ['Area B', true, false],
]) {
  lookups = 0;
  let start = performance.now();
  const before = dates.map(key => plain(read(key, area, privateOverlays)));
  baselineMs = performance.now() - start;
  baselineLookups = lookups;
  lookups = 0;
  start = performance.now();
  const after = ctx.withLeaveReadCache(() => {
    const index = ctx.calendarLeaveIndex(area, privateOverlays, personal);
    assert.equal(ctx.calendarLeaveIndex(area, privateOverlays, personal), index, 'Contexts share one render index');
    if (personal) dates.forEach(key => assert.equal(index.personalStatuses.get(key) || '', ctx.personalLeaveDateStatus(key)));
    return dates.map(key => plain(read(key, area, privateOverlays, index)));
  });
  optimizedMs = performance.now() - start;
  optimizedLookups = lookups;
  assert.deepEqual(after, before, 'Slot order, capacities, GL, ghosts, previews, privacy and statuses match');
  assert.ok(optimizedLookups <= 203, 'At most one RDO resolution per bidder per render');
  if (area === 'Area A') {
    assert.ok(baselineLookups > optimizedLookups * 100);
    console.log(`PASS ${privateOverlays ? 'member desktop/mobile' : 'public'} year: ${baselineMs.toFixed(0)}ms → ${optimizedMs.toFixed(0)}ms; RDO lookups ${baselineLookups} → ${optimizedLookups}`);
  }
}

// Cache is recreated between every render, including in-place changes and misses.
const ownDates = () => ctx.withLeaveReadCache(() => ctx.calendarLeaveIndex('Area A', true, true).overlays);
const ownOn = key => (ownDates().get(key) || []).some(entry => entry.initials === 'ME');
assert.equal(ownOn('2027-06-07'), false, 'Pending Monday RDO excludes Monday initials');
ctx.intakeQueue[0].line = 'TUE';
assert.equal(ownOn('2027-06-07'), true);
assert.equal(ownOn('2027-06-01'), false, 'Changed pending line replaces old weekdays');
ctx.intakeQueue[0].status = 'Approved';
assert.equal(ownOn('2027-06-01'), false, 'Approval retains correct weekdays');
ctx.intakeQueue[0].status = 'Denied';
assert.equal(ownOn('2027-06-01'), true, 'Denied request cannot retain cached weekdays');
ctx.rdoLines[0].cpc = 'ME'; ctx.rdoLines[0].status = 'Taken';
assert.equal(ownOn('2027-06-07'), false, 'Assigned line replaces denied request');
ctx.rdoLines[0].week = ['D', 'D', 'RDO', 'D', 'D', 'D', 'RDO'];
assert.equal(ownOn('2027-06-07'), true, 'In-place admin assignment edit is fresh');
ctx.rdoLines[0].cpc = '';
ctx.supabaseState.connected = false;
ctx.selectedLineId = 'MON';
assert.equal(ownOn('2027-06-01'), false);
ctx.selectedLineId = 'TUE';
assert.equal(ownOn('2027-06-01'), false);
ctx.rdoLines[0].week = ['D', 'RDO', 'D', 'D', 'D', 'D', 'RDO'];
ctx.selectedLineId = 'MON';
assert.equal(ownOn('2027-06-01'), true, 'Preview fallback follows selected line');
ctx.selectedLineId = 'TUE';
assert.equal(ownOn('2027-06-01'), false);
ctx.leaveBids[0].range = 'Jul 1, 2028';
assert.equal(ctx.withLeaveReadCache(() => ctx.calendarLeaveIndex('Area A', true, true).personalStatuses.get('2028-07-01')), 'approved');
ctx.currentUser = null; ctx.intakeQueue = []; ctx.leaveBids = []; ctx.leaveDraftQueue = [];
assert.equal(ctx.withLeaveReadCache(() => ctx.calendarLeaveIndex('Area A', false, false).overlays.size), 0, 'No data survives sign-out');
assert.throws(() => ctx.withLeaveReadCache(() => { throw Error('render failed'); }));
assert.equal(vm.runInContext('leaveReadCache', ctx), null);
console.log('PASS fresh RDO data after pending edits, approval, denial, assignment edits, previews, year changes, sign-out and failures');

// Exercise the production context and consumers used by every calendar mode/layout.
Object.assign(ctx, {
  currentUser: { initials: 'ME', area: 'Area A' }, calendarMode: 'combined',
  leaveRangePreviewActive: false, selectedRdoWeekdays: () => new Set(),
  leaveDraftDateSet: () => new Set(), usesIndividualLeaveDateSelection: () => false,
  leaveSlotMap: () => map,
});
for (const name of ['makeCalendarRenderContext', 'cachedVisibleLeaveSlotDetails', 'cachedPersonalLeaveDateStatus']) {
  vm.runInContext(fn(name), ctx);
}
ctx.leaveBids = [{ range: 'Jun 1, 2027', status: 'Approved', bidAs: 'CPC' }];
for (const publicReadOnly of [false, true]) {
  for (const mode of ['vacation', 'fatigue', 'combined']) {
    ctx.calendarMode = mode;
    for (const deferSlotTooltip of [false, true]) {
      ctx.withLeaveReadCache(() => {
        const render = ctx.makeCalendarRenderContext({ area: 'Area A', showRdo: !publicReadOnly,
          showPersonalLeave: !publicReadOnly, publicReadOnly, deferSlotTooltip });
        assert.deepEqual(plain(ctx.cachedVisibleLeaveSlotDetails('2027-06-01', render)),
          plain(read('2027-06-01', 'Area A', !publicReadOnly)));
        assert.equal(ctx.cachedPersonalLeaveDateStatus('2027-06-01', render), publicReadOnly ? '' : 'approved');
      });
    }
  }
}
console.log('PASS production calendar contexts: member/public, all modes, inline and deferred details');
