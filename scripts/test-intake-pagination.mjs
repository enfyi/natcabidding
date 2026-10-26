import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const target = { innerHTML: '' };
let renderedCards = 0, selectedDetail = null, focused = '', scrolled = false;
const controls = Array.from({ length: 2 }, () => {
  const nodes = Object.fromEntries([
    '[data-intake-page-summary]', '[data-intake-page-number]',
    '[data-intake-page="previous"]', '[data-intake-page="next"]',
  ].map(key => [key, { textContent: '', disabled: false, focus: () => { focused = key; } }]));
  return {
    querySelector: key => nodes[key],
    scrollIntoView: () => { scrolled = true; }, focus: () => { focused = 'navigation'; },
  };
});
const rows = Array.from({ length: 121 }, (_, index) => ({
  id: `bid-${index}`, type: 'RDO Line', status: index === 120 ? 'Pending' : 'Approved',
  initials: index === 119 ? 'ZZ' : 'AB', area: index < 70 ? 'Area A' : 'Area B', round: 1,
  submittedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  approvedAt: new Date(Date.UTC(2026, 9, 2, 0, index)).toISOString(),
}));
const context = vm.createContext({
  INTAKE_PAGE_SIZE: 50, intakePagination: { page: 1, filterKey: '', revealItemId: null },
  intakeSearchQuery: '', intakeSearchEmployeeInitials: '', intakeSort: 'approved',
  intakeFilters: { status: 'all', type: 'all', area: 'all', round: 'all' },
  intakeQueue: rows, currentUser: { initials: 'AB', area: 'Area A' },
  activeIntakeDetailId: null, activeOverrideId: null, activeDenialId: null,
  clearTimeout() {}, intakeSearchRenderTimer: null,
  document: {
    getElementById: id => id === 'intake-queue' ? target : null,
    querySelector: selector => selector === '[data-intake-pagination]' ? controls[0] : null,
    querySelectorAll: selector => selector === '[data-intake-pagination]' ? controls : [],
  },
  syncIntakeSearchControls() {}, hasIntakeAccess: () => true,
  groupedLeaveIntakeItems: () => context.intakeQueue,
  intakeDisplayStatus: item => item.status, intakeItemRound: item => item.round,
  intakeSearchText: item => item.initials.toLowerCase(),
  renderIntakeDetailPanel: item => { selectedDetail = item; },
  escapeHtml: value => value || '', bidTypeLabel: item => item.type,
  intakeBidSummary: () => { renderedCards++; return ''; },
  renderIntakeChangeHistory: () => '', renderIntakeGroupDates: () => '',
  renderIntakeLeaveBalance: () => '', intakeLeaveRoundIsOpen: () => false,
  isGlLeaveItem: () => false,
  renderIntakeDateCheckControl: () => '', intakeSubmissionLabel: () => '',
  intakeReviewerLabel: () => '', intakeCancellationNote: () => '', intakeReviewItemById: () => null,
  withLeaveReadCache: read => read(),
});
vm.runInContext([
  'intakeItemMatchesFilters', 'intakeSortTimestamp', 'compareIntakeItems', 'compareIntakeActionItems',
  'paginateIntakeItems', 'renderIntakePagination', 'renderIntakeQueueWithCache',
  'renderIntakeQueue', 'changeIntakePage',
].map(fn).join('\n'), context);
const ids = () => [...target.innerHTML.matchAll(/data-intake-card="([^"]+)"/g)].map(match => match[1]);
context.renderIntakeQueue();
assert.equal(renderedCards, 50, 'Only the current page builds cards');
assert.equal(ids()[0], 'bid-120', 'Pending bids come first across the full queue');
for (const control of controls) {
  assert.equal(control.querySelector('[data-intake-page-summary]').textContent, 'Showing 1–50 of 121 bids');
  assert.equal(control.querySelector('[data-intake-page="previous"]').disabled, true);
  assert.equal(control.querySelector('[data-intake-page="next"]').disabled, false);
}
const allIds = [...ids()];
context.changeIntakePage('next');
assert.equal(scrolled, true);
assert.equal(focused, '[data-intake-page="next"]');
allIds.push(...ids());
context.changeIntakePage('next');
allIds.push(...ids());
assert.equal(ids().length, 21);
assert.equal(new Set(allIds).size, 121, 'Every bid is reachable without duplicates');
assert.equal(focused, 'navigation', 'Last page retains focus when Next becomes disabled');
context.changeIntakePage('next');
assert.equal(context.intakePagination.page, 3, 'Page is clamped at the end');

context.intakeSearchQuery = 'zz';
context.renderIntakeQueue();
assert.deepEqual(ids(), ['bid-119'], 'Search includes bids from other pages');
assert.equal(context.intakePagination.page, 1);
context.intakeSearchQuery = '';
context.renderIntakeQueue();
context.changeIntakePage('next');
context.intakeFilters.area = 'Area A';
context.renderIntakeQueue();
assert.equal(context.intakePagination.page, 1, 'Filter changes reset pagination');
assert.equal(controls[0].querySelector('[data-intake-page-summary]').textContent, 'Showing 1–50 of 70 bids');
context.intakeFilters.status = 'Denied';
context.renderIntakeQueue();
assert.deepEqual(ids(), []);
assert.equal(controls[0].querySelector('[data-intake-page-summary]').textContent, 'Showing 0 bids');
assert.equal(controls[0].querySelector('[data-intake-page="next"]').disabled, true);
context.intakeFilters.area = context.intakeFilters.status = 'all';
context.renderIntakeQueue();
context.changeIntakePage('next');
context.intakeSort = 'entered';
context.renderIntakeQueue();
assert.equal(context.intakePagination.page, 1, 'Sort changes reset pagination');

context.activeIntakeDetailId = 'bid-110';
context.renderIntakeQueue();
context.changeIntakePage('next');
assert.equal(selectedDetail.id, 'bid-110', 'Paging keeps the selected detail and full history available');
context.changeIntakePage('next');
context.intakeQueue = rows.slice(0, 51);
context.renderIntakeQueue();
assert.equal(context.intakePagination.page, 2, 'Refresh clamps the page after rows disappear');
assert.equal(ids().length, 1);

// Alert links must reveal the containing group, even beyond the first page.
context.intakeQueue = rows.map(row => row.id === 'bid-0' ? { ...row, type: 'Leave', members: [{ id: 'child-day' }] } : row);
context.window = { requestAnimationFrame: read => read() };
context.selectIntakeBidder = () => {};
context.ensureIntakeBidderSelection = () => {};
context.setPage = () => context.renderIntakeQueue();
vm.runInContext(['openIntakeItemFromAlert', 'openIntakeItemFromAlertWithCache'].map(fn).join('\n'), context);
context.openIntakeItemFromAlert('child-day');
assert.equal(context.intakePagination.page, 3);
assert.ok(ids().includes('bid-0'), 'Alert opens the page containing the grouped bid');
assert.equal(selectedDetail.id, 'bid-0');

// Large histories still build just 50 cards.
context.intakeQueue = Array.from({ length: 5000 }, (_, index) => ({ ...rows[0], id: `history-${index}` }));
context.intakePagination.page = 1;
renderedCards = 0;
const start = performance.now();
context.renderIntakeQueue();
assert.equal(renderedCards, 50);
assert.equal(ids().length, 50);
console.log(`PASS intake pagination, full-queue search/filter/sort, boundaries, refresh, detail preservation and grouped alert navigation; 5,000-row fixture rendered in ${(performance.now() - start).toFixed(1)}ms`);
