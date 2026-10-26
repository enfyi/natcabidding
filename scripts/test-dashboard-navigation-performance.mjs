import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const calls = [];
const button = {
  dataset: { page: 'dashboard' }, tagName: 'BUTTON', textContent: 'Dashboard', disabled: false,
  matches: selector => selector === 'button', closest: () => null,
  setAttribute() {}, removeAttribute() {},
};
const context = vm.createContext({
  pendingUiActions: new Set(),
  document: { querySelector: () => null },
  requestAnimationFrame: () => { throw new Error('Navigation must not wait for a frame'); },
  showActionFeedback: () => { throw new Error('Navigation must not show a loading toast'); },
  setPage: page => calls.push(page),
  event: { target: { closest: () => button } },
});
vm.runInContext(`async ${extract('runUiAction')}`, context);
const start = source.indexOf('  const pageNavigation = event.target.closest("[data-page]");');
const end = source.indexOf('  const intakeBidderDetailOpen', start);
const navigating = vm.runInContext(`(async () => {${source.slice(start, end)}})()`, context);
assert.deepEqual(calls, ['dashboard'], 'Page switches in the click task, before yielding');
await navigating;
assert.equal(button.disabled, false);
assert.equal(button.textContent, 'Dashboard');
assert.equal(context.pendingUiActions.size, 0);

const renders = [];
for (const name of ['syncLeaveBuilderInputs', 'renderLeaveRows', 'renderLeaveAllowanceSummary',
  'renderLeaveBucketCards', 'renderLeaveDraftQueue', 'renderLeaveDatePicker', 'renderLeaveSlotBoard']) {
  context[name] = (...args) => renders.push([name, ...args]);
}
vm.runInContext(extract('renderMemberLeaveContent'), context);
context.renderMemberLeaveContent('dashboard');
assert.deepEqual(renders.map(call => call[0]), [
  'renderLeaveRows', 'renderLeaveAllowanceSummary', 'renderLeaveBucketCards',
]);
assert.equal(renders[0][1], 'dashboard-leave-rows');
renders.length = 0;
context.renderMemberLeaveContent('leave');
assert.ok(renders.some(call => call[0] === 'syncLeaveBuilderInputs'));
assert.ok(renders.some(call => call[0] === 'renderLeaveDatePicker'));
console.log('PASS dashboard switches immediately, refreshes balances, and skips hidden draft calculations; Leave Bids retains its builder.');
