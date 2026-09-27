import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8');
const start = source.indexOf('function roundOneWeekKeysForDateKeys(');
const end = source.indexOf('function roundOneProjectedWeekCount(', start);
assert.ok(start >= 0 && end > start, 'Round 1 browser helpers were found');

const context = {
  dateFromKey: (key) => new Date(`${key}T12:00:00Z`),
  dateKeyFromDate: (date) => date.toISOString().slice(0, 10),
  isRoundOneLeaveItem: (item) => item.round === 1,
  datesInLeaveRange: (range) => range,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const selected = ['2027-06-07', '2027-06-08', '2027-06-10', '2027-06-13'];
assert.deepEqual([...context.roundOneWeekKeysForDateKeys(selected)], ['2027-06-07']);
assert.deepEqual(
  [...context.roundOneWeekKeySetForItems(selected.map((date) => ({ round: 1, range: [date] })))],
  ['2027-06-07'],
);
assert.deepEqual(
  [...context.roundOneWeekKeysForDateKeys([...selected, '2027-06-20'])],
  ['2027-06-07', '2027-06-20'],
);
assert.deepEqual(
  [...context.roundOneWeekKeySetForItems(selected.slice(1).map((date) => ({ round: 1, range: [date] })))],
  ['2027-06-08'],
);
assert.deepEqual(
  [...context.roundOneWeekKeysForDateKeys(['2027-06-16', '2027-06-22'])],
  ['2027-06-16'],
);
assert.deepEqual(
  [...context.roundOneWeekKeysForDateKeys(['2027-06-13', '2027-06-19'])],
  ['2027-06-13'],
);
assert.match(source, /const selectedLeaveDates = new Set\(\)/);
assert.match(source, /round >= 1 && round <= 4 && !leaveReplacementRequestId/);
assert.match(source, /nextDates\.has\(key\)[\s\S]*nextDates\.delete\(key\)/);
assert.match(source, /dateKeys\.map\(\(key, index\) => \(\{/);
assert.match(source, /That date would create a third Round 1 bid week/);
assert.match(source, /Dates between selections may be skipped/);
assert.match(source, /Dates do not need to be continuous/);
assert.match(html, /data-leave-selection-label/);
console.log('PASS browser Round 1 buckets move with edited dates and allow skipped days');
