import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let intake = true;
const emails = [];
const context = vm.createContext({
  console, Date, Map, Set, BID_YEAR: 2027, currentUser: { initials: 'ME' },
  intakeQueue: [], intakeGroupReviewState: new Map(), helpThreads: [],
  hasIntakeAccess: () => intake,
  leaveDateKeysForItem: item => [...item.dateKeys],
  dateFromKey: key => new Date(`${key}T12:00:00Z`),
  dateKeyFromDate: date => date.toISOString().slice(0, 10),
  formatIndividualLeaveDates: keys => keys.join(', '), formatCalendarDate: key => key,
  bidTypeLabel: item => item.type, bidRound: item => item.round,
  bidRecipientEmail: () => 'me@example.com', isGlLeaveItem: () => false,
  queueNotificationEmail: (...args) => emails.push(args), BID_OFFICE_CONTACT: 'Contact intake',
});
vm.runInContext(['intakeItemRound', 'roundOneWeekKeysForDateKeys', 'groupedLeaveIntakeItems',
  'alertItems', 'bidEmailDetail', 'queueBidSubmittedEmail'].map(fn).join('\n'), context);
const dates = ['07','08','09','10','11','14','15','16','17','18'];
const rows = dates.map(day => ({ id: `day-${day}`, type: 'Leave', round: 1, area: 'Area A',
  initials: 'ME', status: 'Pending', days: 1, range: `2027-06-${day}`,
  dateKeys: [`2027-06-${day}`], submissionBatchKey: 'batch-1' }));
context.intakeQueue = rows;
let alerts = context.alertItems();
assert.equal(alerts.length, 2, 'Ten dates produce two week notifications for intake');
assert.equal(alerts[0].intakeItemId, 'leave-group-day-07');
assert.match(alerts[0].detail, /Week starting 2027-06-07/);
intake = false;
assert.equal(context.alertItems().length, 2, 'Bidder notifications also group by week');
context.queueBidSubmittedEmail(rows);
assert.equal(emails.length, 1, 'One submission email for the batch');
assert.match(emails[0][2], /2 leave bids/);
assert.equal((emails[0][2].match(/1 bid week/g) || []).length, 2);
rows[0].status = 'Approved';
assert.equal(context.alertItems().length, 3, 'Partial approval remains a separate status');
rows.forEach(row => { row.status = 'Denied'; });
assert.equal(context.alertItems().length, 2, 'Denied weeks remain grouped');
context.intakeQueue.push({ ...rows[0], id: 'other', initials: 'OTHER' });
assert.equal(context.alertItems().length, 2, 'Personal notifications exclude other bidders');
intake = true;
assert.equal(context.alertItems().length, 0, 'Decided bids leave intake alerts');
let alertRenders = 0;
const personalBids = new Map(rows.map(row => [row.id, { status: 'Pending' }]));
context.leaveBidForItem = item => personalBids.get(item.id);
context.renderAlerts = () => { alertRenders++; };
vm.runInContext(fn('updateConfirmedIntakeDecision'), context);
context.intakeQueue = rows.slice(0, 10);
context.intakeQueue.forEach(row => { row.status = 'Pending'; });
const week = context.groupedLeaveIntakeItems()[0];
context.updateConfirmedIntakeDecision(week, 'approved');
assert.equal(alertRenders, 1, 'Notifications render immediately after confirmation');
assert.equal(context.alertItems().length, 1, 'Approved week disappears before the database refresh');
assert.ok(rows.slice(0, 5).every(row => row.status === 'Approved'));
assert.ok(rows.slice(0, 5).every(row => personalBids.get(row.id).status === 'Approved'));
context.updateConfirmedIntakeDecision(rows[5], 'denied', 'No capacity');
assert.equal(rows[5].denialReason, 'No capacity');
assert.equal(rows[6].status, 'Pending', 'Other pending dates remain available');

const calls = [];
const applied = [];
const result = data => ({ data, error: null });
const state = { authUserId: 'user', bidYearId: 'year', loading: false };
let fail = false, fallback = 0;
const client = {
  rpc: async name => { calls.push(name); return name === 'read_bidding_state'
    ? result({ submissions: [] }) : result([]); },
  from: name => ({ select: async () => { calls.push(name); return result([]); } }),
};
const refresh = vm.createContext({
  console: { warn() {} }, BID_YEAR: 2027, supabaseState: state, intakeQueue: [
    { supabaseRequestId: 'removed' }, { supabaseSubmissionId: 'old' }, { id: 'local' }],
  leaveBids: [{ supabaseRequestId: 'removed' }, { id: 'local' }],
  intakeBidderSelection: { record: {}, generation: 1 }, calendarRenderRevision: 0,
  lastAlertDatabaseSnapshot: 'old', supabaseClient: () => client,
  readReferenceData: async (_, read) => read(),
  loadPublishedLeaveSlots: async () => { calls.push('slots'); return fail ? { error: Error('offline') } : result([]); },
  loadRdoLines: async () => { calls.push('lines'); return result([]); },
  loadPublishedGlRdoAssignments: async () => { calls.push('gl'); return result([]); },
  loadPublishedBidWindows: async () => { calls.push('windows'); return result([]); },
  attachLeaveRequestWeekBuckets: async (_, rows) => rows,
  attachSubmissionIdsToLeaveRequests: rows => rows,
  supabaseRows: value => value.data, isMissingSupabaseRoutine: () => false,
  biddingStateSubmissionType: () => 'RDO Line',
  loadSupabaseReferenceData: async () => { fallback++; },
});
for (const name of ['upsertRdoLinesFromDatabase', 'applyGlRdoAssignments',
  'upsertRdoSubmissionsFromDatabase', 'upsertLeaveRequestsFromDatabase',
  'applyLeaveSlotScheduleFromDatabase', 'applyBidWindowsFromDatabase']) refresh[name] = () => applied.push(name);
vm.runInContext(fn('refreshBiddingAfterIntakeDecision'), refresh);
await refresh.refreshBiddingAfterIntakeDecision();
assert.equal(calls.length, 7, 'Only seven changed-data reads; no FAQ, roster, settings or schedules');
assert.equal(applied.length, 6);
assert.equal(fallback, 0);
assert.equal(state.loading, false);
assert.equal(refresh.intakeQueue.length, 1, 'Removed database requests disappear');
assert.equal(refresh.leaveBids.length, 1);
fail = true;
applied.length = 0;
await refresh.refreshBiddingAfterIntakeDecision();
assert.equal(fallback, 1, 'Read failure falls back to complete refresh');
assert.equal(applied.length, 0, 'Failed snapshot is never partially applied');
assert.equal(state.loading, false);
fail = false;
const originalRpc = client.rpc;
client.rpc = async name => {
  const value = await originalRpc(name);
  state.authUserId = 'different-user';
  return value;
};
await refresh.refreshBiddingAfterIntakeDecision();
assert.equal(applied.length, 0, 'A previous session cannot overwrite the current session');
assert.equal(state.loading, false);

const buttons = [{ disabled: false }, { disabled: true }];
const review = vm.createContext({ document: { querySelectorAll: () => buttons } });
vm.runInContext('let intakeDecisionPending = false;\n' + fn('runIntakeDecision'), review);
let release, decisions = 0;
const gate = new Promise(resolve => { release = resolve; });
const action = async () => { decisions++; await gate; };
const first = review.runIntakeDecision(action, 'week');
await review.runIntakeDecision(action, 'week');
assert.equal(decisions, 1, 'Repeated clicks do not submit duplicate approvals');
assert.ok(buttons.every(button => button.disabled));
release(); await first;
assert.equal(buttons[0].disabled, false);
assert.equal(buttons[1].disabled, true, 'Previously disabled buttons stay disabled');
await assert.rejects(review.runIntakeDecision(async () => { throw Error('failed'); }, 'week'));
assert.equal(buttons[0].disabled, false, 'Failure releases the review controls');
console.log('PASS week alerts, submission emails, partial decisions, targeted refresh, failure recovery and duplicate-click protection');
