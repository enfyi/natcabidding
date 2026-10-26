import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf('\n}', start) + 2);
}
const rows = Array.from({ length: 3900 }, (_, index) => {
  const person = Math.floor(index / 13), day = index % 13;
  const round = day < 6 ? 1 : 3;
  return {
    id: `leave-${index}`, type: 'Leave', initials: `P${person}`, bidderId: `bidder-${person}`,
    area: `Area ${'ABCDEF'[person % 6]}`, status: day % 5 ? 'Approved' : 'Pending', round,
    submissionBatchKey: `batch-${person}-${round}`, days: 1,
    dateKeys: [new Date(2027, 0, 1 + person % 10 + day).toISOString().slice(0, 10)],
  };
});
function setup(text) {
  const context = vm.createContext({
    Date, Map, Set, intakeQueue: rows, intakeGroupReviewState: new Map(),
    calendarDateFormatter: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    datesInLeaveRange: () => [], intakeDateChecksOpen: new Set(),
  });
  const formatterStart = text.indexOf('const individualLeaveDateFormatter =');
  if (formatterStart >= 0) vm.runInContext(text.slice(formatterStart, text.indexOf('function formatIndividualLeaveDates(', formatterStart)), context);
  vm.runInContext([
    'dateKey', 'dateFromKey', 'dateKeyFromDate', 'intakeItemRound', 'leaveDateKeysForItem',
    'roundOneWeekKeysForDateKeys', 'formatCalendarDate', 'formatIndividualLeaveDates',
    'groupedLeaveIntakeItems', 'intakeReviewItemById',
  ].map(name => fn(text, name)).join('\n'), context);
  return context;
}
const context = setup(source);
for (const dates of [[], ['2027-02-03'], ['2027-12-31', '2028-01-01'], ['2027-02-04', '2027-02-03', '2027-02-03']]) {
  const sorted = [...new Set(dates)].sort(), years = new Set(sorted.map(key => new Date(`${key}T12:00:00`).getFullYear()));
  const labels = sorted.map(key => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(years.size > 1 ? { year: 'numeric' } : {}),
  }));
  const expected = !dates.length ? '' : years.size > 1 ? labels.join(', ') : `${labels.join(', ')}, ${[...years][0]}`;
  assert.equal(context.formatIndividualLeaveDates(dates), expected, 'Date labels retain their exact format');
}
const started = performance.now();
const groups = context.groupedLeaveIntakeItems();
const groupingMs = performance.now() - started;
const actualGrouping = context.groupedLeaveIntakeItems;
let groupedRows = 0, groupingCalls = 0;
context.groupedLeaveIntakeItems = items => {
  assert.ok(items, 'Interaction lookups must scope grouping to a bidder');
  groupingCalls++;
  groupedRows += items.length;
  return actualGrouping(items);
};
assert.equal(context.intakeReviewItemById(null), null);
assert.equal(context.intakeReviewItemById(undefined), null);
assert.equal(context.intakeReviewItemById('missing'), null);
assert.equal(context.intakeReviewItemById('leave-group-missing'), null);
assert.equal(context.intakeReviewItemById(rows[0].id), rows[0]);
assert.equal(groupingCalls, 0, 'Absent denial forms and direct requests do not group the queue');
const lookupStart = performance.now();
for (const group of groups.filter(group => group.members).slice(0, 30)) {
  assert.equal(JSON.stringify(context.intakeReviewItemById(group.id)), JSON.stringify(group),
    'Scoped lookup must match full-queue grouping, including week boundaries, statuses and batches');
}
const lookupMs = performance.now() - lookupStart;
assert.ok(groupedRows <= 30 * 13, 'Grouped lookups inspect only the selected bidder round');

let dateRenders = 0, selected = null, detailRows = null;
const content = { hidden: true, innerHTML: '' };
const button = { dataset: { intakeCheckDates: groups[0].id }, parentElement: { querySelector: () => content }, setAttribute(key, value) { this[key] = value; } };
let focusedCard = null;
const cards = groups.slice(0, 50).map(item => {
  const card = { dataset: { intakeCard: item.id }, selected: false, focus() { focusedCard = item.id; } };
  card.classList = { toggle: (_, selected) => { card.selected = selected; } };
  return card;
});
Object.assign(context, {
  activeIntakeDetailId: null, withLeaveReadCache: read => read(),
  renderIntakeDateCheck: item => { dateRenders++; return item.id; },
  document: { querySelectorAll: () => cards },
  renderIntakeDetailPanel: (item, items) => { selected = item; detailRows = items; },
  selectIntakeBidder: (initials, profileId) => { assert.equal(initials, selected.initials); assert.equal(profileId, selected.bidderId); },
  revealIntakeDetail() {},
  renderIntakeQueue() { throw Error('Selecting a bid must not redraw the queue'); },
});
vm.runInContext(['toggleIntakeDateCheck', 'updateIntakeCardSelection', 'selectIntakeQueueItem'].map(name => fn(source, name)).join('\n'), context);
context.toggleIntakeDateCheck(button);
assert.equal(content.hidden, false);
assert.equal(dateRenders, 1);
const callsBeforeHide = groupingCalls;
context.toggleIntakeDateCheck(button);
assert.equal(content.hidden, true);
assert.equal(content.innerHTML, '');
assert.equal(dateRenders, 1);
assert.equal(groupingCalls, callsBeforeHide, 'Hiding dates does no grouping or availability work');
context.toggleIntakeDateCheck(button);
assert.equal(dateRenders, 2, 'Reopening recalculates current availability');
const selectionStart = performance.now();
context.selectIntakeQueueItem(groups[0].id);
const selectionMs = performance.now() - selectionStart;
assert.equal(selected.id, groups[0].id, 'Grouped cards select the correct bidder');
assert.equal(cards[0].selected, true);
assert.equal(cards[1].selected, false);
assert.ok(detailRows.every(row => row.initials === selected.initials && row.round === selected.round));
assert.equal(JSON.stringify(detailRows), JSON.stringify(groups.filter(row => row.initials === selected.initials && row.round === selected.round)),
  'Bidder detail retains the same history as the full queue');
assert.equal(cards.length, 50, 'Existing cards and open disclosures remain in place');

// Exercise the production click and keyboard wiring, not just helper functions.
const clickStart = source.indexOf('  const intakeCard = event.target.closest("[data-intake-card]");');
const clickEnd = source.indexOf('  const fatigueButton', clickStart);
const keyboardStart = source.indexOf('  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-intake-card]"))');
assert.ok(keyboardStart >= 0, 'Keyboard activation is restricted to the card itself');
const keyboardEnd = source.indexOf('\n});', keyboardStart);
let selections = 0;
context.selectIntakeQueueItem = id => { assert.equal(id, groups[0].id); selections++; };
context.event = { target: { closest: () => ({ dataset: { intakeCard: groups[0].id } }) } };
vm.runInContext(`(() => {${source.slice(clickStart, clickEnd)}})()`, context);
assert.equal(selections, 1);
let prevented = 0;
context.event = { key: 'Enter', preventDefault: () => { prevented++; }, target: { matches: () => true, dataset: { intakeCard: groups[0].id } } };
vm.runInContext(`(() => {${source.slice(keyboardStart, keyboardEnd)}})()`, context);
assert.equal(selections, 2);
assert.equal(prevented, 1);
context.event.target.matches = () => false;
vm.runInContext(`(() => {${source.slice(keyboardStart, keyboardEnd)}})()`, context);
assert.equal(selections, 2, 'Enter on a nested action button must not also select the card');

const closeStart = source.indexOf('  if (event.target.closest("[data-intake-detail-close]"))');
const closeEnd = source.indexOf('  const leaveSortButton', closeStart);
context.event = { target: { closest: () => ({}) } };
vm.runInContext(`(() => {${source.slice(closeStart, closeEnd)}})()`, context);
assert.equal(selected, null);
assert.equal(context.activeIntakeDetailId, null);
assert.ok(cards.every(card => !card.selected));
assert.equal(focusedCard, groups[0].id, 'Closing detail restores focus without redrawing cards');

const originalGroupingCalls = groupingCalls;
context.intakeQueue = rows.filter(row => row.id !== groups[0].members[0].id);
assert.equal(context.intakeReviewItemById(groups[0].id), null, 'Removed groups never return cached data');
assert.equal(groupingCalls, originalGroupingCalls);

console.log(`PASS fresh date checks, zero-work hide/absent forms, exact grouped lookups, and targeted bid details. 3,900 rows → ${groups.length} groups in ${groupingMs.toFixed(1)}ms; 30 scoped lookups ${lookupMs.toFixed(1)}ms; selection ${selectionMs.toFixed(1)}ms.`);
const baselinePath = process.argv[2];
if (baselinePath) {
  const baseline = setup(readFileSync(baselinePath, 'utf8'));
  let start = performance.now();
  const before = baseline.groupedLeaveIntakeItems();
  const beforeMs = performance.now() - start;
  assert.equal(JSON.stringify(before), JSON.stringify(groups), 'Optimization preserves all grouped output');
  start = performance.now();
  baseline.intakeReviewItemById(groups[0].id);
  console.log(`Same fixture before fix: grouping ${beforeMs.toFixed(1)}ms; grouped lookup ${(performance.now() - start).toFixed(1)}ms.`);
}
