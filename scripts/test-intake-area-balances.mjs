import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8');
const start = source.indexOf('function renderIntakeAreaBalances(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
let writes = 0, rosterReads = 0, bidReads = 0, dateReads = 0, markup = '';
const target = { dataset: {}, set innerHTML(value) { writes++; markup = value; } };
const areas = ['Area A', 'Area B', 'Area C', 'Area D', 'Area E', 'Area F', 'TMU'];
const people = areas.flatMap(area => ['CPC', 'DEV'].map(bidAs => ({ area, bidAs, leaveSlotAllowance: 80.8 })));
people.push({ area: 'Area A', bidAs: 'CPC', leaveSlotAllowance: 800, exempt: true });
const bids = [{ area: 'Area A', bidAs: 'CPC', days: 4 },
  { area: 'Area B', bidAs: 'DEV', days: 20 },
  { area: 'Area A', bidAs: 'CPC', days: 100, exempt: true }];
const context = vm.createContext({
  document: { querySelector: () => target }, hasIntakeAccess: () => true,
  ZLA_AREAS: areas, LEAVE_SLOT_HOURS_PER_DAY: 8,
  bueRoster: () => { rosterReads++; return people; },
  areaCommittedLeaveItems: () => { bidReads++; return bids; },
  isAreaLeaveBalanceExemptPerson: person => person.exempt,
  isAreaLeaveBalanceExemptItem: item => item.exempt,
  leaveSlotBucketForBidAs: role => role.toLowerCase(),
  normalizeLeaveSlotAllowance: Number, estimatedLeaveDaysFromHours: (hours, perDay) => hours / perDay,
  leaveItemArea: item => item.area, leaveItemBidAs: item => item.bidAs,
  leaveItemAreaUsedDays: item => { dateReads++; return item.days; },
  escapeHtml: String, formatRoundedUpLeaveDays: String,
  formatRoundedUpLeaveDaysLabel: days => `${days} days`,
});
vm.runInContext(fn, context);
context.renderIntakeAreaBalances();
assert.equal(rosterReads, 1);
assert.equal(bidReads, 1);
assert.equal(dateReads, 2, 'Each capacity-consuming bid is evaluated only once across all areas');
assert.equal((markup.match(/<h3>/g) || []).length, 7);
assert.match(markup, /7 days/);
assert.match(markup, /0 days/);
assert.match(markup, /4 of 11 used/);
context.renderIntakeAreaBalances();
assert.equal(writes, 1, 'Unchanged totals preserve the existing DOM');
bids[0].days = 5;
context.renderIntakeAreaBalances();
assert.equal(writes, 2, 'Changed totals refresh');
assert.match(markup, /6 days/);
assert.ok(html.indexOf('data-intake-area-balances') < html.indexOf('data-intake-bidder-overview'));
assert.match(source, /setTimeout\(\(\) => renderIntakeQueue\(\{ refreshBalances: false \}\), 200\)/,
  'Search does not recalculate area balances');
assert.doesNotMatch(fn, /supabaseClient|\.rpc\(|fetch\(/, 'Balances require no network requests');
console.log('PASS all-area totals, exemptions, exhausted balances, single-pass reads, unchanged DOM and search isolation');
