import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const names = ['withLeaveReadCache', 'renderMemberLeaveContent', 'renderMemberPageContent', 'renderApp', 'renderAppWithCache'];
const calls = [];
let page = 'intake';
const context = {
  document: { querySelector: () => ({ dataset: { pagePanel: page } }) },
  BID_YEAR: 2027, calendarRenderRevision: 0, leaveReadCache: null,
  isMemberAppVisible: () => true, buildSeniority: () => [],
};
const stubs = ['syncBidYearControls', 'syncPilotControls', 'setText', 'renderPublicPage',
  'renderCurrentUser', 'renderCalendars', 'updateSelectedLine', 'renderHelpSummary',
  'renderHelpPanel', 'renderAlerts', 'updateBidWindow', 'syncLeaveBuilderInputs',
  'renderLeaveRows', 'renderLeaveAllowanceSummary', 'renderLeaveBucketCards',
  'renderLeaveDraftQueue', 'renderLeaveDatePicker', 'renderLeaveSlotBoard',
  'syncRdoFilterControls', 'renderRdoLines', 'renderSubmittedLeaveManager',
  'renderSeniority', 'renderIntakeSchedule', 'renderHistory', 'renderRoundRuleSummaryList',
  'renderApprovalRuleSummary', 'renderIntakeQueue', 'renderManualBidEntry',
  'ensureIntakeBidderSelection', 'renderAdminConsole', 'renderAdminToolsPage'];
for (const name of stubs) context[name] = (...args) => calls.push([name, ...args]);
vm.createContext(context);
vm.runInContext(names.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n'), context);

for (page of ['intake', 'admin', 'admin-tools', 'rdos', 'history']) {
  calls.length = 0;
  const revision = context.calendarRenderRevision;
  context.renderApp();
  assert.equal(context.calendarRenderRevision, revision + 1, 'Hidden calendars become stale after mutations');
  for (const name of ['renderLeaveAllowanceSummary', 'renderLeaveBucketCards', 'renderLeaveDraftQueue', 'renderLeaveSlotBoard', 'renderLeaveRows']) {
    assert.ok(!calls.some(call => call[0] === name), `${page} skips hidden ${name}`);
  }
  assert.ok(calls.some(call => call[0] === 'renderAlerts'), 'Saved requests update alerts');
}
for (page of ['dashboard', 'leave', 'calendar']) {
  calls.length = 0;
  context.renderMemberPageContent(page);
  if (page !== 'calendar') {
    assert.ok(calls.some(call => call[0] === 'renderLeaveAllowanceSummary'), 'Navigation refreshes balances');
    const target = page === "dashboard" ? "dashboard-leave-rows" : "leave-page-rows";
    assert.ok(calls.some(call => call[0] === "renderLeaveRows" && call[1] === target));
  }
  if (page === 'leave') assert.ok(calls.some(call => call[0] === 'renderLeaveDraftQueue'));
  if (page !== 'dashboard') assert.ok(calls.some(call => call[0] === 'renderLeaveSlotBoard'));
}
assert.equal(context.leaveReadCache, null, 'Render caches do not retain stale data');
console.log('PASS intake/admin mutations skip hidden leave calculations; navigation refreshes leave data and calendars');
