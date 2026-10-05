import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let editing = false, active = true, queueRenders = 0, summaryRenders = 0, alertRenders = 0;
const timers = new Map();
const client = {
  rpc: async name => ({ data: name === 'read_bidding_state' ? { submissions: [] } : name === 'read_leave_intake_queue' ? [{ id: 'new-bid', status: 'Pending' }] : [] }),
  from: () => ({ select: async () => ({ data: [] }) }),
};
const context = vm.createContext({
  console, BID_YEAR: 2027, intakeQueue: [], helpThreads: [], intakeDecisionPending: false,
  supabaseState: { authUserId: 'admin', connected: true, loading: false },
  document: { visibilityState: 'visible', querySelector: () => active ? {} : null },
  supabaseClient: () => client, isMemberAppVisible: () => true, hasIntakeAccess: () => true,
  hasActiveIntakeEditing: () => editing,
  currentHelpRequester: () => ({ sessionId: 'session' }),
  attachLeaveRequestWeekBuckets: async (_, rows) => rows,
  attachSubmissionIdsToLeaveRequests: rows => rows,
  biddingStateSubmissionType: () => 'RDO Line', inferRdoBidChanges() {},
  upsertLeaveRequestsFromDatabase: rows => context.intakeQueue.push(...rows),
  helpThreadFromRpc: row => row,
  renderAlerts: () => alertRenders++,
  renderIntakeQueue: () => { queueRenders++; assert.equal(context.intakeQueue[0].id, 'new-bid'); },
  renderIntakeBidderSummary: () => summaryRenders++,
  setTimeout: action => { timers.set(1, action); return 1; }, clearTimeout: id => timers.delete(id),
});
vm.runInContext(`let alertRefreshPending = false;
let lastAlertDatabaseSnapshot = '';
let liveIntakeQueueRenderPending = false;
let liveIntakeQueueRenderTimer = null;
` + [fn('renderLiveIntakeQueue'), fn('refreshLiveAlerts')].join('\n'), context);
await context.refreshLiveAlerts();
assert.equal(alertRenders, 1);
assert.equal(queueRenders, 1, 'Live submissions redraw approval rows without navigation');
assert.equal(summaryRenders, 1);
editing = true;
vm.runInContext('liveIntakeQueueRenderPending = true', context);
context.renderLiveIntakeQueue();
assert.equal(queueRenders, 1, 'Editing is preserved');
assert.equal(timers.size, 1);
editing = false;
timers.get(1)();
assert.equal(queueRenders, 2, 'Deferred redraw runs after editing even when the database snapshot is unchanged');
active = false;
vm.runInContext('liveIntakeQueueRenderPending = true', context);
context.renderLiveIntakeQueue();
assert.equal(queueRenders, 2, 'Other pages are not redrawn');
const target = { innerHTML: '' };
const older = { id: 'reviewed', type: 'RDO Line', status: 'Pending', submittedAt: '2026-10-05T18:00:00Z' };
const newer = { ...older, id: 'new-pending', submittedAt: '2026-10-05T19:00:00Z' };
const sorted = vm.createContext({
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
vm.runInContext(['intakeSortTimestamp', 'compareIntakeItems', 'renderIntakeQueueWithCache'].map(fn).join('\n'), sorted);
sorted.renderIntakeQueueWithCache();
sorted.intakeQueue.push(newer);
sorted.renderIntakeQueueWithCache();
assert.ok(target.innerHTML.indexOf('data-intake-card="new-pending"') < target.innerHTML.indexOf('data-intake-card="reviewed"'),
  'A new pending bid sorts above the bid currently under review');
const historyPanel = { hidden: true, innerHTML: '' };
const history = vm.createContext({
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
assert.equal(history.intakeRoundDetailItems(approved, historyRows)[0].id, pending.id, 'Pending requests stay above reviewed history with approval-time sorting');
sorted.intakeSort = 'approved';
sorted.intakeQueue = [{ ...older, status: 'Approved', approvedAt: '2026-10-05T20:00:00Z' }, newer];
sorted.renderIntakeQueueWithCache();
assert.ok(target.innerHTML.indexOf('data-intake-approve="new-pending"') < target.innerHTML.indexOf('data-intake-card="reviewed"'),
  'The actionable pending row stays first even with the default approval-time sort');
console.log('Live intake queue regression checks passed.');
