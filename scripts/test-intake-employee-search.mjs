import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
const people = [
  { initials: 'OC', firstName: 'Michael', lastName: 'Schoelen', area: 'Area A', rank: 4 },
  { initials: 'VZ', firstName: 'Zachary', lastName: 'Vetor', area: 'Area E', rank: 14 },
];
const elements = Object.fromEntries(['search', 'employee-results', 'employee-status'].map(key => [`[data-intake-${key}]`, { setAttribute() {} }]));
const context = vm.createContext({
  intakeSearchQuery: 'sch', intakeSearchEmployeeInitials: '',
  intakeFilters: {status: 'all', type: 'all', area: 'all', round: 'all'},
  bueRoster: () => people, bueByInitials: initials => people.find(p => p.initials === initials),
  personDisplayName: p => `${p.firstName} ${p.lastName}`, escapeHtml: String,
  document: { querySelector: key => elements[key] },
  intakeSearchText: item => `${item.name} ${item.initials}`.toLowerCase(),
  intakeDisplayStatus: item => item.status, intakeItemRound: item => item.round,
});
vm.runInContext(['manualBidControllerMatches', 'renderIntakeEmployeeSearch', 'intakeItemMatchesFilters'].map(extract).join('\n'), context);
context.renderIntakeEmployeeSearch();
assert.match(elements['[data-intake-employee-results]'].innerHTML, /Michael Schoelen/);
assert.doesNotMatch(elements['[data-intake-employee-results]'].innerHTML, /Zachary/);
context.intakeSearchQuery = 'vz';
context.renderIntakeEmployeeSearch();
assert.match(elements['[data-intake-employee-results]'].innerHTML, /Zachary Vetor/);
const ownBid = { initials: 'VZ', name: 'Zachary Vetor', status: 'Approved', area: 'Area E' };
assert.equal(context.intakeItemMatchesFilters(ownBid), true);
context.intakeSearchEmployeeInitials = 'OC';
context.intakeSearchQuery = 'Michael Schoelen';
assert.equal(context.intakeItemMatchesFilters(ownBid), false);
assert.equal(context.intakeItemMatchesFilters({ ...ownBid, initials: 'OC', name: 'Old stored name' }), true);
context.renderIntakeEmployeeSearch();
assert.equal(elements['[data-intake-employee-results]'].hidden, true);
context.intakeFilters.status = 'Pending';
assert.equal(context.intakeItemMatchesFilters({ ...ownBid, initials: 'OC' }), false);
context.intakeSearchEmployeeInitials = '';
context.intakeSearchQuery = '';
context.intakeFilters.status = 'all';
assert.equal(context.intakeItemMatchesFilters(ownBid), true);
console.log('Intake employee matching and selected bidder filtering checks passed.');
