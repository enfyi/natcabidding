import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const row = (id, status, days, extra = {}) => ({ id, supabaseRequestId: id, type: 'Leave', initials: 'AB',
  name: 'Alex Bidder', area: 'Area A', bidAs: 'CPC', seniority: 12, round: 2, status, days,
  range: id, summary: `Round 2 · ${days} charged days`, submittedAt: 'Oct 24, 2026 09:15', ...extra });
const request = row('request', 'Pending', 5, {
  range: 'Jul 12–16, 2027',
  summary: 'Round 2 · Jul 12–16, 2027 · 5 charged days',
});
const target = { innerHTML: '' };
let allowance = 200, hours = 8, known = true, visits = 0, saves = 0;
const context = vm.createContext({
  console, Map, Set, clearTimeout() {}, intakeSearchRenderTimer: null, currentUser: { initials: 'AB' },
  leaveBids: [row('approved', 'Approved', 15), { ...request }],
  intakeQueue: [row('approved', 'Approved', 15), row('other', 'Pending', 3), request,
    row('denied', 'Denied', 50), row('cancelled', 'Cancelled', 50)],
  bueByInitials: () => known ? { leaveSlotAllowance: allowance } : null,
  leaveRoundForItem: item => item.round,
  leaveItemChargedDays: item => { visits++; return item.days; },
  leaveHolidayDateSet: items => new Set(items.flatMap(item => item.holidays || [])),
  leaveHoursPerDayForInitials: () => hours,
  escapeHtml: text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  formatEstimatedLeaveDays: value => String(value),
  document: { getElementById: id => id === 'intake-queue' ? target : null, querySelector: () => null },
  syncIntakeSearchControls() {}, hasIntakeAccess: () => true,
  groupedLeaveIntakeItems: () => context.intakeQueue.filter(item => item.status === 'Pending'),
  intakeItemMatchesFilters: () => true, compareIntakeActionItems: () => 0,
  activeIntakeDetailId: null, activeOverrideId: null, activeDenialId: null,
  renderIntakeDetailPanel() {}, renderIntakeChangeHistory: () => '', renderIntakeGroupDates: () => '',
  renderIntakeDateCheckControl: () => '', intakeReviewConflicts: () => [],
  leaveRdoConflicts() {}, leaveApprovalConflicts() {}, intakeDisplayStatus: item => item.status,
  bidTypeLabel: item => item.type, intakeBidSummary: item => item.summary,
  isGlLeaveItem: () => false, intakeSubmissionLabel: () => 'Submitted by bidder (AB) · Oct 24, 2026, 9:15 AM',
  intakeCancellationNote: () => '', intakeLeaveRoundIsOpen: () => true,
  intakeReviewItemById: () => request, intakeGroupReviewState: new Map(),
  persistIntakeDecision: async () => { saves++; return true; },
  updateConfirmedIntakeDecision() {}, queueBidVerifiedEmail() {}, scheduleIntakeDecisionRefresh() {}, setPage() {},
});
vm.runInContext('let leaveReadCache = null;\n' + [
  'withLeaveReadCache', 'cachedLeaveRead', 'intakeLeaveBalanceIndex', 'intakeLeaveBalance',
  'renderIntakeLeaveBalance', 'renderIntakeQueueWithCache', 'renderIntakeQueue', 'approveIntakeItem',
  'intakeLeaveApprovalAttributes',
].map(fn).join('\n'), context);

let balance = context.withLeaveReadCache(() => context.intakeLeaveBalance(request));
assert.equal(balance.approved, 15);
assert.equal(balance.otherPending, 3);
assert.equal(balance.requestDays, 5);
assert.equal(balance.remaining, 2, 'Duplicates, denied, and cancelled requests do not consume balance');
assert.equal(context.renderIntakeLeaveBalance({ type: 'RDO Line' }), '');
const group = { ...request, members: [row('a', 'Pending', 2), row('b', 'Pending', 3)] };
assert.equal(context.intakeLeaveBalance(group).otherPending, 3, 'Grouped requests are subtracted exactly once');
hours = 10;
assert.equal(context.intakeLeaveBalance(request).remaining, -3, 'CWS uses ten-hour charged days');
allowance = 231;
assert.equal(context.intakeLeaveBalance(request).remaining, 1, 'CWS fractional allowance rounds up to a whole day');
assert.equal(context.intakeLeaveBalance(request).accruedHours, 231, 'Accrued hours remain unchanged');
for (const scheduleHours of [8, 10]) {
  hours = scheduleHours;
  allowance = 27 * hours + 0.8 * hours;
  assert.equal(context.intakeLeaveBalance(request).remaining, 5, 'Both schedules round 4.8 remaining days up to five');
  const rendered = context.renderIntakeLeaveBalance(request);
  assert.match(rendered, /<summary[^>]*>5 days left<\/summary>/, 'Queue badge displays the rounded bid days');
  assert.ok(rendered.includes(`${allowance} accrued hours`), 'Expanded breakdown retains the original accrued hours');
  assert.match(rendered, /Rounded up to whole days/, 'Expanded breakdown explains the rounding');
  const exactHours = allowance - 23 * hours;
  assert.equal(context.intakeLeaveBalance(request).exactRemainingHours, exactHours,
    'Displayed hours subtract approved and all pending bids from actual accrual');
  assert.ok(rendered.includes(`${exactHours.toLocaleString('en-US', { maximumFractionDigits: 3 })} accrued hours remaining`));
  if (scheduleHours === 10) assert.match(rendered, /5 days remaining.*48 accrued hours remaining/,
    'CWS shows five bid days with 48 actual hours, rather than 50 rounded hours');
  allowance = 22 * hours + 0.8 * hours;
  assert.equal(context.intakeLeaveApprovalAttributes(request), '', 'The final rounded-up day can be approved');
  const beforeSave = saves;
  await context.approveIntakeItem(request.id);
  assert.equal(saves, beforeSave + 1, 'Approval handler also accepts the rounded allowance');
  allowance = 22 * hours;
  assert.match(context.intakeLeaveApprovalAttributes(request), /disabled/, 'Exact whole-day allowance cannot gain an extra day');
  allowance = 21 * hours + 0.8 * hours;
  assert.match(context.intakeLeaveApprovalAttributes(request), /disabled/, 'Rounding does not permit a second extra day');
}
saves = 0;
hours = 10;
allowance = 230;
assert.equal(context.intakeLeaveBalance(request).remaining, 0, 'An exact fit is allowed');
context.intakeQueue[0].holidays = ['2027-01-01', '2027-02-15'];
assert.equal(context.intakeLeaveBalance({ ...request, round: 4 }).credits, 2);
assert.equal(context.intakeLeaveBalance(request).credits, 0, 'Early rounds do not receive holiday credits');
context.intakeQueue[1].holidays = ['2027-01-01'];
assert.equal(context.intakeLeaveBalance({ ...request, round: 4 }).credits, 2, 'Holiday dates are unique');
known = false;
assert.match(context.renderIntakeLeaveBalance(request), /Balance unavailable/);
await context.approveIntakeItem(request.id);
assert.equal(saves, 0, 'Unavailable balance blocks before persistence');
known = true; allowance = 200; hours = 10;
await context.approveIntakeItem(request.id);
assert.equal(saves, 0, 'Overdrawn balance blocks before persistence');
context.intakeReviewItemById = () => group;
await context.approveIntakeItem(group.id);
assert.equal(saves, 0, 'Grouped approval uses the same guard');
context.intakeReviewItemById = () => request;
hours = 8;
await context.approveIntakeItem(request.id);
assert.equal(saves, 1, 'Valid approval saves without an extra read');
delete request.reviewNote;

// Index work must stay linear, even when the queue contains many cards per bidder.
const originalQueue = context.intakeQueue;
context.intakeQueue = Array.from({ length: 5000 }, (_, index) => row(`load-${index}`, 'Pending', 1));
visits = 0;
const start = performance.now();
context.withLeaveReadCache(() => {
  for (const item of context.intakeQueue) context.intakeLeaveBalance(item);
});
const elapsed = performance.now() - start;
assert.ok(visits < 11000, `Expected a shared index, got ${visits} charged-day reads`);
context.intakeQueue = originalQueue;
assert.equal(context.intakeLeaveBalance(request).remaining, 2, 'Cache does not survive changes');
console.log(`PASS intake balances, grouping, credits, CWS, exact hours, approval guards; 5,000 balances in ${elapsed.toFixed(1)}ms`);

if (process.argv.includes('--preview')) {
  // Render the production queue with synthetic data, without authentication or database writes.
  const directory = '/tmp/zla-intake-preview';
  mkdirSync(directory, { recursive: true });
  context.intakeQueue = originalQueue.filter(item => item.initials === 'AB');
  context.intakeItemMatchesFilters = item => item.id === request.id;
  context.renderIntakeQueue();
  const enough = target.innerHTML;
  allowance = 160;
  context.renderIntakeQueue();
  const over = target.innerHTML;
  const css = readFileSync(new URL('../bidding.css', import.meta.url), 'utf8');
  writeFileSync(`${directory}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Intake Queue · Leave Balance Preview</title><style>${css}
    body { padding: 32px; } main { max-width: 1150px; margin: auto; } .preview-section { color: #172033; } .preview-note { color: #526477; margin-bottom: 24px; }
    .preview-section { margin: 28px 0 14px; font-size: 15px; } #intake-queue { display: grid; gap: 14px; }
    @media(max-width:720px) { body { padding: 14px; } }
    </style><main class="app-main"><span class="intake-type">NATCA ZLA · Intake / Admin</span><h1>Intake Queue</h1><p class="preview-note">Preview with sample bidder data · Production queue layout and balance renderer · Approval actions are disabled in this preview.</p>
    <h2 class="preview-section">Enough days · 200-hour allowance</h2><div id="intake-queue">${enough}</div>
    <h2 class="preview-section">Over allowance · 160-hour allowance</h2><div id="intake-queue">${over}</div></main><script>document.querySelectorAll('button').forEach(button => { button.disabled = true; });</script></html>`);
  console.log(`Preview written to ${directory}/index.html`);
}
