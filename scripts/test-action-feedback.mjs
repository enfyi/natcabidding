import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
let notice;
let formListener;
const timers = new Map();
let timerId = 0;
const button = { tagName: 'BUTTON', textContent: 'Save', disabled: false, setAttribute() {}, removeAttribute() {} };
const form = { querySelector: () => button, addEventListener: (type, listener) => { formListener = listener; } };
const context = vm.createContext({
  document: {
    querySelector: selector => selector === '[data-test-form]' ? form : notice,
    createElement: () => ({ dataset: {}, setAttribute() {} }),
    body: { appendChild: element => { notice = element; } },
  },
  requestAnimationFrame: callback => callback(),
  setTimeout: (callback, ms) => { if (!ms) queueMicrotask(callback); else timers.set(++timerId, callback); return timerId; },
  clearTimeout: id => timers.delete(id),
});
vm.runInContext(source.slice(source.indexOf('let actionFeedbackTimer;'), source.indexOf('function setManualBidStatus(')), context);
let release;
let calls = 0;
const operation = context.runUiAction('save', button, 'Saving…', async () => {
  calls++;
  await new Promise(resolve => { release = resolve; });
  context.showActionFeedback('Saved.', 'success');
});
assert.equal(button.disabled, true);
assert.equal(button.textContent, 'Saving…');
await context.runUiAction('save', button, 'Saving…', () => { calls++; });
assert.equal(calls, 1, 'Repeated clicks do not start another save');
release();
await operation;
assert.equal(button.disabled, false);
assert.equal(button.textContent, 'Save');
assert.equal(notice.textContent, 'Saved.');
assert.equal(notice.dataset.status, 'success');
await context.runUiAction('save', button, 'Saving…', () => { throw Error('Offline'); });
assert.equal(notice.dataset.status, 'error');
assert.equal(notice.textContent, 'Offline');
assert.equal(button.disabled, false, 'Failure releases the control for retry');
const rdoButton = { ...button, dataset: {} };
await context.runUiAction('rdo-submit', rdoButton, 'Submitting bid…', () => {
  rdoButton.dataset.awaitingRdoDecision = 'true';
  rdoButton.textContent = 'Awaiting Intaker Decision';
});
assert.equal(rdoButton.disabled, true, 'Cleanup retains the RDO pending-decision lock');
assert.equal(rdoButton.textContent, 'Awaiting Intaker Decision');
const select = { ...button, tagName: 'SELECT', textContent: 'Area A Area B' };
await context.runUiAction('area', select, 'Loading…', () => {});
assert.equal(select.textContent, 'Area A Area B', 'Loading does not replace select options');
let captured;
context.bindUiActionForm('[data-test-form]', 'form-save', 'Saving…', event => { captured = event; });
const event = { currentTarget: form, submitter: button, preventDefault() {} };
formListener(event);
event.currentTarget = null;
await new Promise(resolve => setImmediate(resolve));
assert.equal(captured.currentTarget, form, 'Form handler retains its target after event dispatch');
assert.equal(button.disabled, false);
assert.equal(typeof captured.preventDefault, 'function');
await context.runUiAction('save', button, 'Saving…', () => { button.textContent = 'Add new'; });
assert.equal(button.textContent, 'Add new', 'A form reset can change the label after saving');

function fn(name) {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const feedback = [];
const item = { initials: 'AB', status: 'Pending' };
const intake = vm.createContext({
  document: { querySelectorAll: () => [] },
  intakeReviewItemById: () => item,
  intakeGroupReviewState: new Map(),
  showActionFeedback: (message, status) => feedback.push({ message, status }),
});
vm.runInContext('let intakeDecisionPending = false;\n' + fn('runIntakeDecision'), intake);
await intake.runIntakeDecision(async () => { item.status = 'Approved'; }, 'id');
assert.equal(feedback.at(-1).status, 'success');
item.status = 'Pending';
await intake.runIntakeDecision(async () => { item.reviewNote = 'Capacity is full.'; }, 'id');
assert.deepEqual(feedback.at(-1), { message: 'Capacity is full.', status: 'error' });
assert.equal(feedback.filter(entry => entry.status === 'success').length, 1, 'A failed approval never announces success');
await intake.runIntakeDecision(async () => { intake.intakeGroupReviewState.set('id', { reviewNote: 'Batch not saved.' }); }, 'id');
assert.equal(feedback.at(-1).message, 'Batch not saved.');
console.log('PASS loading labels, duplicate prevention, error recovery, form targets, and confirmed intake outcomes');
