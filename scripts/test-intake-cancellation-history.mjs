import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = (name) => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n}', start) + 2); };
const context = vm.createContext({
  escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  intakeItemRound: item => item.round,
  intakeReviewerLabel: initials => `Intake Rep ${initials}`,
  renderIntakeLeaveEditHistory: () => '<div>Earlier date edit</div>',
  renderIntakeAdminEditHistory: () => '',
});
vm.runInContext(['renderIntakeCancellationHistory', 'renderIntakeChangeHistory'].map(extract).join('\n'), context);
const item = { type: 'Leave', status: 'Cancelled', range: 'Jun 7, 2027', round: 2, cancelledBy: 'IT', cancelledAt: 'Oct 26, 2026 10:00 AM' };
const html = context.renderIntakeChangeHistory(item);
for (const text of ['intake-change-history', 'Leave cancellation', 'Round 2', 'Before:', 'Jun 7, 2027', 'After:', 'no longer hold leave slots', 'Intake Rep IT', item.cancelledAt, 'Earlier date edit']) assert.ok(html.includes(text), text);
assert.equal(context.renderIntakeCancellationHistory({ ...item, status: 'Approved' }), '');
assert.equal(context.renderIntakeCancellationHistory({ ...item, type: 'RDO Line' }), '');
const unknown = context.renderIntakeCancellationHistory({ ...item, cancelledBy: '', cancelledAt: '' });
assert.match(unknown, /Unknown reviewer/);
assert.match(unknown, /Time not recorded/);
assert.doesNotMatch(context.renderIntakeCancellationHistory({ ...item, range: '<script>' }), /<script>/);
assert.match(source, /cancelledBy: row.status === "cancelled" \? row.reviewedBy/);
console.log('PASS persisted cancellation history shows removed date, reviewer, time, and prior edits without affecting approved bids');
