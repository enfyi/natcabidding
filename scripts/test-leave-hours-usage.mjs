import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const helpersStart = source.indexOf('function formatRoundedUpLeaveDays(');
const helpersEnd = source.indexOf('function submittedRdoLineForInitials(', helpersStart);

assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'Leave-day formatting helpers were found');

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(helpersStart, helpersEnd), context);

assert.equal(context.formatRoundedUpLeaveDaysLabel(21.1), '22 days');
assert.equal(context.formatRoundedUpLeaveDaysLabel(21.9), '22 days');
assert.equal(context.formatRoundedUpLeaveDaysLabel(21), '21 days');
assert.equal(context.formatRoundedUpLeaveDaysLabel(1), '1 day');
assert.match(
  source,
  /setText\("\[data-leave-left-days\]", formatRoundedUpLeaveDaysLabel\(leftDays\)\)/,
  'The employee leave balance uses full-day ceiling rounding',
);

console.log('PASS remaining employee leave rounds up to the next full day');
