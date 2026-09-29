import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function sortLeaveDraftQueueByDate(');
const end = source.indexOf('function isRoundOneLeaveItem(', start);
assert.ok(start >= 0 && end > start, 'Leave draft date-order helper was found');

const context = {
  leaveDraftQueue: [
    { id: 'later', dateKeys: ['2027-09-12'] },
    { id: 'earliest', dateKeys: ['2027-03-04'] },
    { id: 'middle', dateKeys: ['2027-06-08'] },
  ],
  leaveDateKeysForItem(item) {
    return item.dateKeys;
  },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.sortLeaveDraftQueueByDate();

assert.deepEqual(
  Array.from(context.leaveDraftQueue, (item) => item.id),
  ['earliest', 'middle', 'later'],
  'Individual leave drafts are kept in chronological order'
);
assert.match(source, /leaveDraftQueue\.push\(\.\.\.newDrafts\);\s*sortLeaveDraftQueueByDate\(\);/);
assert.match(source, /leaveDraftQueue = leaveDraftQueue\.filter[\s\S]*?sortLeaveDraftQueueByDate\(\);/);
assert.match(source, /leaveDraftQueue\.map\(\(draft, index\) => \(\{[\s\S]*?priority: startingPriority \+ index/);

console.log('PASS individual leave drafts are re-sorted without additional network work');
