import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const timers = new Map();
let nextTimer = 0, suggestions = 0, queueRenders = 0;
const context = vm.createContext({
  intakeSearchQuery: '', intakeSearchEmployeeInitials: 'OLD', intakeSearchRenderTimer: null,
  renderIntakeEmployeeSearch: () => { suggestions++; },
  renderIntakeQueueWithCache: () => { queueRenders++; },
  withLeaveReadCache: read => read(),
  clearTimeout: id => timers.delete(id),
  setTimeout: (callback, delay) => {
    assert.equal(delay, 200);
    timers.set(++nextTimer, callback);
    return nextTimer;
  },
});
vm.runInContext(fn('renderIntakeQueue') + '\n' + fn('updateIntakeSearch'), context);
for (const query of ['J', 'Jo', 'Jon']) context.updateIntakeSearch(query);
assert.equal(suggestions, 3, 'Suggestions update immediately for each keystroke');
assert.equal(queueRenders, 0, 'Typing never synchronously rebuilds the bid queue');
assert.equal(timers.size, 1, 'Rapid keystrokes coalesce into one queue render');
assert.equal(context.intakeSearchQuery, 'Jon');
assert.equal(context.intakeSearchEmployeeInitials, '');
[...timers.values()][0]();
assert.equal(queueRenders, 1);
assert.equal(timers.size, 0);
context.updateIntakeSearch('Jo');
context.intakeSearchEmployeeInitials = 'JO';
context.renderIntakeQueue();
assert.equal(timers.size, 0, 'Selecting an employee cancels the delayed render');
assert.equal(queueRenders, 2, 'Selection renders immediately');
context.updateIntakeSearch('');
[...timers.values()][0]();
assert.equal(context.intakeSearchQuery, '', 'Clearing search restores an empty filter');
assert.equal(queueRenders, 3);
assert.match(source, /if \(intakeSearch\) \{\s+updateIntakeSearch\(intakeSearch.value\);/);
console.log('PASS immediate intake suggestions, coalesced queue rendering, selection and clearing');

const roster = [
  { firstName: 'Jane', lastName: 'Smith', initials: 'JS', area: 'Area A', bidAs: 'CPC' },
  { firstName: 'James', lastName: 'Johnson', initials: 'JJ', area: 'Area B', bidAs: 'CPC' },
  { firstName: 'Chris', lastName: 'Jsmith', initials: 'CJ', area: 'Area C', bidAs: 'CPC' },
];
context.bueRoster = () => roster;
vm.runInContext(fn('intakeEmployeeSearchMatches'), context);
assert.deepEqual(Array.from(context.intakeEmployeeSearchMatches(' js ')), [roster[0]],
  'Exact initials exclude unrelated names containing the same letters');
assert.deepEqual(Array.from(context.intakeEmployeeSearchMatches('JANE')), [roster[0]]);
assert.deepEqual(Array.from(context.intakeEmployeeSearchMatches('Johnson')), [roster[1]]);
assert.equal(context.intakeEmployeeSearchMatches('J').length, 3, 'Partial names and initials remain searchable');
assert.equal(context.intakeEmployeeSearchMatches('CPC').length, 0, 'Roles do not clutter bidder suggestions');
assert.equal(context.intakeEmployeeSearchMatches('').length, 0);
console.log('PASS exact initials, case and whitespace handling, partial names and focused bidder suggestions');
