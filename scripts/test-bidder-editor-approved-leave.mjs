import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const leave = ['approved', 'cancelled', 'pending', 'denied', 'expired', 'draft'].map((status, i) => ({
  id: `request-${i}`, status, round_number: 1, priority: i + 1, charged_days: 2,
  requested_start_date: '2027-06-07', requested_end_date: '2027-06-08',
}));
const inputs = new Map();
const form = {
  innerHTML: '',
  querySelector: selector => inputs.has(selector) ? { value: inputs.get(selector) } : null,
};
const context = vm.createContext({
  bidderEditor: { record: { snapshot: { leave }, lines: [] }, person: { bid_role: 'CPC', area: 'Area A' } },
  document: { querySelector: () => form },
  escapeHtml: value => String(value ?? ''), BID_YEAR: 2027,
});
for (const [start, end] of [
  ['function bidderEditorDraft()', 'function bidderEditorSetBusy('],
  ['function renderBidderEditorForm()', 'async function loadBidderEditor('],
]) {
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
}
vm.runInContext('renderBidderEditorForm()', context);
assert.match(form.innerHTML, /data-editor-start="request-0"/);
for (const row of leave.slice(1)) assert.ok(!form.innerHTML.includes(`data-editor-start="${row.id}"`), row.status);
assert.match(form.innerHTML, /No approved leave bids in this round/);
inputs.set('[data-editor-start="request-0"]', '2027-06-09');
inputs.set('[data-editor-end="request-0"]', '2027-06-10');
// Even stale inputs for cancelled requests must never change their saved dates.
inputs.set('[data-editor-start="request-1"]', '2027-08-01');
const draft = JSON.parse(JSON.stringify(vm.runInContext('bidderEditorDraft()', context)));
assert.equal(draft.leave[0].start_date, '2027-06-09');
assert.equal(draft.leave[0].end_date, '2027-06-10');
for (const [i, row] of leave.entries()) {
  if (i === 0) continue;
  assert.deepEqual(draft.leave[i], { id: row.id, start_date: row.requested_start_date, end_date: row.requested_end_date });
}
inputs.set('[data-editor-start="request-0"]', '');
assert.equal(vm.runInContext('bidderEditorDraft()', context).leave[0].start_date, null);
console.log('PASS bidder editor shows only approved leave and preserves hidden request dates during save');
