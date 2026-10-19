import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let editing = true, active = true, queueRenders = 0, summaryRenders = 0;
const timers = new Map();
const context = vm.createContext({
  intakeDecisionPending: false, activeOverrideId: null, activeDenialId: null,
  bidderEditor: { busy: false },
  document: { querySelector: () => active ? {} : null },
  hasIntakeAccess: () => true, hasActiveIntakeEditing: () => editing,
  renderIntakeQueue: () => queueRenders++,
  renderIntakeBidderSummary: () => summaryRenders++,
  setTimeout: action => { timers.set(1, action); return 1; }, clearTimeout: id => timers.delete(id),
});
vm.runInContext(`let liveIntakeQueueRenderPending = true;
let liveIntakeQueueRenderTimer = null;
` + fn('renderLiveIntakeQueue'), context);
context.renderLiveIntakeQueue();
assert.equal(queueRenders, 1, 'Manual selection and unsaved forms do not block incoming queue rows');
assert.equal(summaryRenders, 0, 'The selected bidder editor is preserved');
context.activeDenialId = 'review';
vm.runInContext('liveIntakeQueueRenderPending = true', context);
context.renderLiveIntakeQueue();
assert.equal(queueRenders, 1, 'Open denial form is preserved');
assert.equal(timers.size, 1);
context.activeDenialId = null;
editing = false;
timers.get(1)();
assert.equal(queueRenders, 2, 'Deferred queue redraw resumes when review closes');
assert.equal(summaryRenders, 1);
active = false;
vm.runInContext('liveIntakeQueueRenderPending = true', context);
context.renderLiveIntakeQueue();
assert.equal(queueRenders, 2, 'Other pages are not redrawn');
const target = { innerHTML: '' };
const older = { id: 'reviewed', type: 'RDO Line', status: 'Pending', submittedAt: '2026-10-05T18:00:00Z' };
const newer = { ...older, id: 'new-pending', submittedAt: '2026-10-05T19:00:00Z' };
const sorted = vm.createContext({
  intakeDisplayStatus: item => item.status, renderIntakeDateCheckControl: () => '',
  intakeCancellationNote: () => '',
  intakeSort: 'entered', activeIntakeDetailId: older.id, activeOverrideId: null, activeDenialId: null,
  document: { getElementById: id => id === 'intake-queue' ? target : null, querySelector: () => null },
  syncIntakeSearchControls() {}, hasIntakeAccess: () => true,
  hasSystemAdminAccess: () => false, intakeReviewerLabel: () => '',
  groupedLeaveIntakeItems: () => sorted.intakeQueue,
  intakeItemMatchesFilters: () => true,
  renderIntakeDetailPanel: item => assert.equal(item.id, older.id, 'The reviewed bid stays selected'),
  escapeHtml: value => value || '', bidTypeLabel: item => item.type,
  intakeBidSummary: item => item.summary || '',
  renderIntakeChangeHistory: () => '', renderIntakeGroupDates: () => '', intakeSubmissionLabel: () => '',
  intakeReviewItemById: () => null,
  intakeQueue: [older],
});
vm.runInContext(['intakeSortTimestamp', 'compareIntakeItems', 'compareIntakeActionItems', 'renderIntakeQueueWithCache'].map(fn).join('\n'), sorted);
sorted.renderIntakeQueueWithCache();
sorted.intakeQueue.push(newer);
sorted.renderIntakeQueueWithCache();
assert.ok(target.innerHTML.indexOf('data-intake-card="new-pending"') < target.innerHTML.indexOf('data-intake-card="reviewed"'),
  'A new pending bid sorts above the bid currently under review');
const historyPanel = { hidden: true, innerHTML: '' };
const history = vm.createContext({
  intakeDisplayStatus: item => item.status, intakeCancellationNote: () => '',
  intakeSort: 'entered', intakeItemRound: item => item.round,
  document: { querySelector: () => historyPanel },
  escapeHtml: value => value || '', bidTypeLabel: item => item.type,
  renderIntakeChangeHistory: () => '',
});
vm.runInContext(['intakeSortTimestamp', 'compareIntakeItems', 'intakeRoundDetailItems', 'renderIntakeDetailPanel'].map(fn).join('\n'), history);
const approved = { ...older, initials: 'MS', round: 2, status: 'Approved', summary: 'Older approval', approvedAt: '2026-10-05T20:00:00Z' };
const denied = { ...approved, id: 'denied', status: 'Denied', summary: 'Older denial' };
const pending = { ...newer, initials: 'MS', round: 2, summary: 'Newest pending request' };
const historyRows = [approved, denied];
history.renderIntakeDetailPanel(approved, historyRows);
historyRows.push(pending, { ...pending, id: 'other-bidder', initials: 'AB' }, { ...pending, id: 'other-round', round: 3 });
history.renderIntakeDetailPanel(approved, historyRows);
assert.ok(historyPanel.innerHTML.indexOf('Newest pending request') < historyPanel.innerHTML.indexOf('Older approval'),
  'New pending requests appear first in the open bidder history');
assert.deepEqual(Array.from(history.intakeRoundDetailItems(approved, historyRows), item => item.id), ['new-pending', 'reviewed', 'denied']);
assert.equal(historyRows[0], approved, 'Sorting history does not reorder the source queue');
history.intakeSort = 'approved';
assert.equal(history.intakeRoundDetailItems(approved, historyRows)[0].id, approved.id, 'Reviewed history retains its selected approval-time order');
sorted.intakeSort = 'approved';
sorted.intakeQueue = [{ ...older, status: 'Approved', approvedAt: '2026-10-05T20:00:00Z' }, newer];
sorted.renderIntakeQueueWithCache();
assert.ok(target.innerHTML.indexOf('data-intake-approve="new-pending"') < target.innerHTML.indexOf('data-intake-card="reviewed"'),
  'The actionable pending row stays first even with the default approval-time sort');
console.log('Live intake queue regression checks passed.');
