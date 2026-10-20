import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1));
const context = vm.createContext({
  escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  datesBetweenKeys: (start, end) => [start, end], formatLeaveRangeFromKeys: keys => keys.join(' – '),
  formatDateTime: value => value.toISOString(), currentUser: {role: 'intake'},
  pilotState: {database: true, enabled: true}, pilotOpenRounds: [1, 2],
  ZLA_AREAS: ['A'], roundWindows: round => round === 2 ? [{start: new Date(0), end: new Date('2099-01-01')}] : [],
});
vm.runInContext(['intakeItemRound', 'intakeLeaveRoundIsOpen', 'renderIntakeLeaveEditHistory', 'renderIntakeAdminEditHistory', 'renderIntakeChangeHistory'].map(extract).join('\n'), context);
context.edit = {id: 'one', before: {start_date: '2027-06-01', end_date: '2027-06-02'}, after: {start_date: '2027-06-03', end_date: '2027-06-04'}, editedBy: '<AB>', editedAt: '2026-10-20T12:00:00Z'};
context.item = {type: 'Leave', round: 2, members: [{leaveEditHistory: [context.edit]}, {leaveEditHistory: [context.edit]}]};
const markup = vm.runInContext('renderIntakeChangeHistory(item)', context);
assert.match(markup, /Leave date edit · Round 2/);
assert.match(markup, /Before:<\/b> 2027-06-01 – 2027-06-02/);
assert.match(markup, /After:<\/b> 2027-06-03 – 2027-06-04/);
assert.match(markup, /&lt;AB&gt; · 2026-10-20/);
assert.equal((markup.match(/Leave date edit/g) || []).length, 1);
context.item = {type: 'Leave', round: 1, leaveEditHistory: [{...context.edit, after: context.edit.before}]};
assert.equal(vm.runInContext('renderIntakeChangeHistory(item)', context), '');
for (const pilot of [true, false]) {
  context.pilotState.database = pilot;
  for (const role of ['intake', 'controller', 'admin']) {
    context.currentUser = {role};
    for (const round of [1, 2, 3, 4, 5, 6]) assert.equal(vm.runInContext(`intakeLeaveRoundIsOpen({round:${round}})`, context), role === 'admin' || round === 2);
  }
}
console.log('PASS leave edit history renders dates, actor/time, grouped entries and escaping; intake is current-round-only and admins can edit across rounds.');
