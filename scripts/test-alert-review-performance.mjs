import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let labels = 0;
const slots = Object.fromEntries(Array.from({ length: 365 }, (_, i) => {
  const key = new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10);
  return [key, { date: key, area: 'Area A', cpc: [], dev: [] }];
}));
const context = vm.createContext({
  currentUser: { area: 'Area A' }, leaveSlotWeeks: [], extraLeaveSlotData: slots,
  slotMatchesArea: (day, area) => day.area === area,
  formatCalendarDate: key => { labels++; return key; },
  isHolidayDate: () => false, isHolidayInLieuDate: () => false,
});
vm.runInContext('let leaveReadCache = null;\n' + ['withLeaveReadCache', 'cachedLeaveRead',
  'leaveSlotMap', 'leaveSlotMapUncached', 'leaveSlotsForDateFromMap', 'leaveSlotsForDate'].map(fn).join('\n'), context);
const dates = Object.keys(slots).slice(0, 300);
const read = () => dates.map(key => context.leaveSlotsForDate(key));
let start = performance.now();
const before = read();
const beforeMs = performance.now() - start;
assert.equal(labels, 365 * 300);
labels = 0;
start = performance.now();
const after = context.withLeaveReadCache(read);
const afterMs = performance.now() - start;
assert.deepEqual(after, before, 'Cached capacity reads match original values');
assert.equal(labels, 365, 'One area map per render instead of one per request date');
context.withLeaveReadCache(() => {
  assert.equal(context.leaveSlotMap('Area B')[dates[0]], undefined, 'Areas remain separate');
});
slots[dates[0]].cpc = ['ME'];
assert.deepEqual([...context.withLeaveReadCache(() => context.leaveSlotsForDate(dates[0])).cpc], ['ME'], 'Changes are visible on the next render');
assert.throws(() => context.withLeaveReadCache(() => { throw Error('failed render'); }));
assert.equal(vm.runInContext('leaveReadCache', context), null);
let summaryCache = false;
const summary = vm.createContext({
  withLeaveReadCache: read => {
    summaryCache = true;
    try { return read(); } finally { summaryCache = false; }
  },
  renderIntakeBidderSummaryWithCache: () => {
    assert.equal(summaryCache, true, 'Async bidder results also render inside a read cache');
  },
});
vm.runInContext(fn('renderIntakeBidderSummary'), summary);
summary.renderIntakeBidderSummary();

for (const activePage of ['dashboard', 'intake']) {
  let queueRenders = 0, summaryRenders = 0, selections = 0;
  const card = { dataset: { intakeCard: 'week' }, scrollIntoView() {}, focus() {} };
  const frames = [];
  const nav = vm.createContext({
    withLeaveReadCache: read => read(), groupedLeaveIntakeItems: () => [{ id: 'week', initials: 'ME', bidderId: 'bidder', members: [{ id: 'day' }] }],
    activeIntakeDetailId: null, activeOverrideId: 'old', activeDenialId: 'old',
    intakeSearchQuery: 'other', intakeFilters: { status: 'Denied', area: 'Area B' },
    document: { querySelector: () => ({ dataset: { pagePanel: activePage } }), querySelectorAll: () => [card] },
    window: { requestAnimationFrame: read => frames.push(read) },
    selectIntakeBidder: (_, __, options) => { assert.equal(options.deferRender, true); selections++; },
    renderIntakeQueue: () => { queueRenders++; },
    ensureIntakeBidderSelection: () => { summaryRenders++; },
    setPage: page => {
      assert.equal(page, 'intake');
      if (activePage !== 'intake') { queueRenders++; summaryRenders++; }
    },
  });
  vm.runInContext(['openIntakeItemFromAlert', 'openIntakeItemFromAlertWithCache'].map(fn).join('\n'), nav);
  nav.openIntakeItemFromAlert('day');
  assert.equal(queueRenders, 1, `Only one queue render from ${activePage}`);
  assert.equal(summaryRenders, 1);
  assert.equal(selections, 1);
  assert.equal(nav.activeIntakeDetailId, 'week');
  assert.equal(nav.intakeSearchQuery, '');
  assert.ok(Object.values(nav.intakeFilters).every(value => value === 'all'));
  while (frames.length) frames.shift()();
  nav.openIntakeItemFromAlert('missing');
  assert.equal(queueRenders, 1, 'Missing alert requests leave the current page alone');
}
let summaryCalls = 0, loads = 0;
const selection = { initials: 'ME', profileId: 'bidder', loading: true, record: null, generation: 1 };
const selected = vm.createContext({
  intakeBidderSelection: selection,
  bueByInitials: initials => ({ initials, profileId: 'bidder' }),
  renderIntakeBidderSummary: () => { summaryCalls++; },
  loadSelectedIntakeBidder: () => { loads++; },
});
vm.runInContext(fn('selectIntakeBidder'), selected);
selected.selectIntakeBidder('ME', 'bidder');
assert.equal(loads, 0, 'An in-flight bidder read is not restarted');
selected.selectIntakeBidder('OTHER', 'other', { deferRender: true });
assert.equal(summaryCalls, 1, 'Alert navigation defers summary rendering to the intake page');
assert.equal(selection.loading, false, 'A different bidder can load without waiting for the old read');
assert.equal(selection.generation, 2, 'Old bidder responses are invalidated');
console.log(`PASS alert review renders once, bidder read deduplication, fresh capacity data; 300 capacity reads ${beforeMs.toFixed(1)}ms → ${afterMs.toFixed(1)}ms, map entries formatted 109500 → 365`);
