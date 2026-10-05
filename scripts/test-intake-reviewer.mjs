import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
const context = vm.createContext({
  currentUser: { initials: 'VIEWER', area: 'Area A' },
  senioritySource: [['', '', '', 'MS', '', '', '', '', '', '', 'admin'], ['', '', '', 'VM', '', '', '', '', '', '', 'intake']],
  seniorityEntryAppRole: entry => entry[10],
  currentRoundNumber: () => 1,
  controllerName: person => `${person.firstName} ${person.lastName}`,
  normalizeBidRoleForArea: role => role,
  uiStatusFromDatabase: status => status,
  formatDateTime: date => date.toISOString(),
  fatigueGroupPreferenceLabel: group => group,
  supabaseLeaveRequestToIntakeItem: row => ({ type: 'Leave', supabaseRequestId: row.id }),
  intakeSubmissionIdFromBiddingState: () => '',
  bueRoster: () => [{ initials: 'MS', firstName: 'Michael', lastName: 'Schoelen' }],
});
for (const name of ['supabaseRdoSubmissionToIntakeItem', 'attachSubmissionIdsToLeaveRequests', 'intakeReviewerLabel']) {
  vm.runInContext(extract(name), context);
}
const item = context.supabaseRdoSubmissionToIntakeItem({ id: 'rdo', submittedAt: '2026-10-05T18:21:00Z', initials: 'RY', status: 'approved', reviewedBy: 'MS', reviewedAt: '2026-10-05T18:23:00Z' });
assert.equal(item.approvedBy, 'MS');
assert.equal(item.approvedAt, '2026-10-05T18:23:00.000Z');
const rows = context.attachSubmissionIdsToLeaveRequests([{ id: 'leave' }], [{ id: 'submission', requestId: 'leave', status: 'approved', reviewedBy: 'MS' }]);
assert.equal(rows[0].reviewedBy, 'MS');
assert.equal(context.intakeReviewerLabel('MS'), 'Admin MS');
assert.equal(context.intakeReviewerLabel('OC'), 'Intake Rep OC');
assert.equal(context.intakeReviewerLabel('VM'), 'Intake Rep VM');
assert.equal(context.intakeReviewerLabel(undefined), 'Unknown reviewer');
assert.match(extract('supabaseLeaveRequestToIntakeItem'), /approvedBy: row.reviewedBy \|\| ""/);
console.log('Intake reviewer identity checks passed.');

for (const name of ['submissionRoleLabel', 'intakeSubmissionLabel']) {
  vm.runInContext(extract(name), context);
}
for (const [role, label] of [['controller', 'user'], ['intake', 'intake rep'], ['admin', 'admin']]) {
  assert.equal(context.submissionRoleLabel(role), label);
  assert.equal(context.intakeSubmissionLabel({ submittedBy: 'MS', submittedByRole: label, submittedAt: '2026-10-05T18:23:00Z' }), `Submitted by ${label} (MS) · 2026-10-05T18:23:00.000Z`);
}
assert.match(context.intakeSubmissionLabel({ initials: 'RY', submittedAt: '2026-10-05T18:23:00Z' }), /unknown submitter/);
const attributed = context.supabaseRdoSubmissionToIntakeItem({ id: 'rdo', submittedAt: '2026-10-05T18:21:00Z', initials: 'RY', status: 'approved', payload: { submittedBy: 'MS', submittedByRole: 'admin' } });
assert.equal(attributed.submittedBy, 'MS');
assert.equal(attributed.submittedByRole, 'admin');
const leave = context.attachSubmissionIdsToLeaveRequests([{ id: 'leave' }], [{ requestId: 'leave', payload: { submittedBy: 'OC', submittedByRole: 'intake rep' } }]);
assert.equal(leave[0].submittedBy, 'OC');
assert.equal(leave[0].submittedByRole, 'intake rep');
console.log('Intake submission attribution checks passed.');

Object.assign(context, {
  intakeQueue: [{ type: 'Leave', status: 'Approved', approvedBy: 'OC', deniedBy: 'OLD', approvedAt: 'Oct 5, 2026, 11:28 AM' }, { type: 'RDO Line', status: 'Approved', approvedBy: 'MS' }],
  leaveBids: [{ status: 'Approved', approvedBy: 'OC', approvedAt: 'Oct 5, 2026, 11:28 AM' }],
  rdoLines: [], seniority: [], intakeSchedules: [], helpThreads: [], history: [], prototypeEmails: [],
  bidTypeLabel: item => item.type,
  isGlLeaveItem: () => false,
  userFullName: () => 'Ryan Johnson',
  currentUserBidAs: () => 'CPC',
});
for (const name of ['intakeBidSummary', 'biddingExportActionBy', 'biddingExportRows']) vm.runInContext(extract(name), context);
const exported = context.biddingExportRows();
assert.equal(exported[0][7], 'Action by');
assert.equal(exported[1][7], 'OC');
assert.equal(exported[1][8], 'Oct 5, 2026, 11:28 AM');
assert.equal(exported[2][7], 'MS');
assert.equal(exported[3][7], 'OC');
assert.equal(context.biddingExportActionBy({ status: 'Denied', approvedBy: 'OLD', deniedBy: 'MS' }), 'MS');
console.log('Export Action by column checks passed for RDO and leave approvals.');

context.lineForArea = (line, area) => line.area === area;
context.rdoLines = [
  { line: '1', area: 'Area A', pattern: 'S/S' },
  { line: '1', area: 'Area D', pattern: 'F/S' },
];
assert.equal(context.intakeBidSummary({ type: 'RDO Line', area: 'Area A', line: '1', summary: 'Round 1 · Line 1 · Group A' }), 'Round 1 · Line 1 S/S · Group A');
assert.equal(context.intakeBidSummary({ type: 'RDO Line', area: 'Area D', line: '1', summary: 'Ghost Line 1 · Group B' }), 'Ghost Line 1 F/S · Group B');
assert.equal(context.intakeBidSummary({ type: 'RDO Line', area: 'Area E', line: '1', summary: 'Line 1 · Group A' }), 'Line 1 · Group A');
assert.equal(context.intakeBidSummary({ type: 'Leave', summary: 'July 8 · 1 day' }), 'July 8 · 1 day');
console.log('RDO summaries show the correct area-specific days off.');

for (const [flex, aws, expected] of [[true, false, 'Flex Yes · AWS No'], [false, true, 'Flex No · AWS Yes'], ['Yes', 'No', 'Flex Yes · AWS No']]) {
  assert.equal(context.intakeBidSummary({ type: 'RDO Line', area: 'Area A', line: '1', flex, aws, summary: 'Line 1 · Flex true · AWS · Mid BID' }), `Line 1 S/S · ${expected} · Mid BID`);
}
assert.equal(context.intakeBidSummary({ type: 'RDO Line', summary: 'Line 9 · Flex false · AWS true · Mid Yes' }), 'Line 9 · Flex No · AWS Yes · Mid Yes');
console.log('Flex and AWS display Yes/No while preserving Mid.');
