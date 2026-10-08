import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let refreshes = 0, renders = 0, release, editing = false;
const timers = new Map();
let nextTimer = 0;
const state = { authUserId: 'admin', loading: false };
const context = vm.createContext({
  console: { warn() {} }, supabaseState: state, BID_YEAR: 2027,
  hasActiveIntakeEditing: () => editing,
  setTimeout: action => { timers.set(++nextTimer, action); return nextTimer; },
  clearTimeout: id => timers.delete(id),
  refreshBiddingAfterIntakeDecision: async options => {
    assert.equal(typeof options.expectedDecisionRevision, 'number');
    refreshes++;
    await new Promise(resolve => { release = resolve; });
  },
  renderApp: () => { renders++; },
});
vm.runInContext(`let intakeDecisionPending = false;
let intakeDecisionRevision = 0;
let intakeDecisionRefreshTimer = null;
let intakeDecisionRefreshRunning = false;
` + ['scheduleIntakeDecisionRefresh','refreshIdleIntakeDecisions'].map(fn).join('\n'), context);
context.scheduleIntakeDecisionRefresh();
context.scheduleIntakeDecisionRefresh();
assert.equal(timers.size, 1, 'Rapid decisions share a refresh timer');
editing = true;
await context.refreshIdleIntakeDecisions();
assert.equal(refreshes, 0, "Active editing postpones background reads");
editing = false;
const first = context.refreshIdleIntakeDecisions();
assert.equal(refreshes, 1);
await context.refreshIdleIntakeDecisions();
assert.equal(refreshes, 1, 'Only one background refresh can run');
vm.runInContext('intakeDecisionRevision++;', context);
release(); await first;
assert.equal(renders, 0, 'An older snapshot does not redraw after a newer decision');
assert.equal(timers.size, 1);
vm.runInContext('intakeDecisionPending = true;', context);
await context.refreshIdleIntakeDecisions();
assert.equal(refreshes, 1, 'Refresh waits while another save is in flight');
vm.runInContext('intakeDecisionPending = false;', context);
const latest = context.refreshIdleIntakeDecisions();
release(); await latest;
assert.equal(renders, 1, 'Latest idle snapshot redraws once');
const whileEditing = context.refreshIdleIntakeDecisions();
editing = true;
release(); await whileEditing;
assert.equal(renders, 1, "Editing begun during the read prevents redraw");
editing = false;
context.refreshBiddingAfterIntakeDecision = async () => { throw Error('offline'); };
await context.refreshIdleIntakeDecisions();
assert.equal(vm.runInContext('intakeDecisionRefreshRunning', context), false, 'Refresh failure releases its lock');
assert.equal(renders, 1, 'A refresh failure does not change confirmed decisions');

let saved = 0, scheduled = 0;
const items = new Map(['first','second'].map(id => [id, { id, type: 'Leave', status: 'Pending' }]));
const approval = vm.createContext({
  showActionFeedback() {}, intakeGroupReviewState: new Map(),
  document: { querySelectorAll: () => [] },
  intakeReviewItemById: id => items.get(id), activeOverrideId: null, activeDenialId: null,
  persistIntakeDecision: async () => { saved++; return true; },
  updateConfirmedIntakeDecision: item => { item.status = 'Approved'; },
  queueBidVerifiedEmail() {}, renderIntakeQueue() {}, setPage() {},
  scheduleIntakeDecisionRefresh: () => { scheduled++; },
  refreshBiddingAfterIntakeDecision: () => { throw Error('Approval must not wait for refresh'); },
});
vm.runInContext('let intakeDecisionPending = false;\n' + ['runIntakeDecision','approveIntakeItem'].map(fn).join('\n'), approval);
await approval.runIntakeDecision(approval.approveIntakeItem, 'first');
await approval.runIntakeDecision(approval.approveIntakeItem, 'second');
assert.equal(saved, 2, 'The next decision can save before background reads finish');
assert.equal(scheduled, 2);
assert.equal(items.get('first').status, 'Approved');
assert.equal(items.get('second').status, 'Approved');
assert.equal(vm.runInContext('intakeDecisionPending', approval), false);
for (const name of ['approveIntakeItem','denyIntakeItem','reviewIntakeLeaveGroup']) {
  assert.doesNotMatch(fn(name), /await refreshBiddingAfterIntakeDecision/);
  assert.match(fn(name), /scheduleIntakeDecisionRefresh/);
}
let visible = true, focused = false;
const panel = {
  dataset: {},
  closest: selector => selector === '.page.active' && visible ? {} : null,
};
const editor = vm.createContext({
  activeOverrideId: null, activeDenialId: null, bidderEditor: { busy: false },
  document: {
    activeElement: {
      matches: () => focused,
      closest: selector => selector === '.app-shell' || selector === '.page.active' ? {} : null,
    },
    querySelectorAll: () => [panel],
  },
});
vm.runInContext(['hasActiveIntakeEditing', 'markIntakeEditing'].map(fn).join('\n'), editor);
assert.equal(editor.hasActiveIntakeEditing(), false);
editor.markIntakeEditing({ target: { closest: () => panel } });
assert.equal(editor.hasActiveIntakeEditing(), true, 'Dirty input remains protected after focus leaves');
visible = false;
assert.equal(editor.hasActiveIntakeEditing(), false, 'Leaving the form allows refresh');
visible = true;
delete panel.dataset.approvalRefreshDirty;
assert.equal(editor.hasActiveIntakeEditing(), false, 'Saved forms no longer block refresh');
panel.dataset.manualBidSubmitting = 'true';
assert.equal(editor.hasActiveIntakeEditing(), true, 'A manual save in flight is protected');
delete panel.dataset.manualBidSubmitting;
focused = true;
assert.equal(editor.hasActiveIntakeEditing(), true, 'Focused fields are protected before their first change');
focused = false;
editor.activeOverrideId = 'request';
assert.equal(editor.hasActiveIntakeEditing(), true);
editor.activeOverrideId = null;
editor.activeDenialId = 'request';
assert.equal(editor.hasActiveIntakeEditing(), true);
editor.activeDenialId = null;
editor.bidderEditor.busy = true;
assert.equal(editor.hasActiveIntakeEditing(), true);
console.log('PASS next approval unlocks after save, refresh batching, in-flight save protection, stale-read discard and refresh failure recovery');
