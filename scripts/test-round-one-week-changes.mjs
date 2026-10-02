import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const context = {
  bidChangeRound: 1, bidChangeWeek: null, bidChangeRows: [], leaveManagementPendingId: '',
  currentUser: { initials: 'AB' }, window: { confirm: () => true },
  dateFromKey: key => new Date(`${key}T12:00:00Z`),
  dateKeyFromDate: date => date.toISOString().slice(0, 10),
  isBidLeaveYearDate: key => key >= '2027-01-10' && key <= '2028-01-08',
  isRdoDateForInitials: key => [0, 6].includes(new Date(`${key}T12:00:00Z`).getUTCDay()),
  renderBidChangeModal: () => {},
};
vm.createContext(context);
for (const name of ['addDaysToDateKey', 'bidChangeCount', 'bidChangeDraftSelection', 'selectRoundOneBidChangeWeek', 'updateRoundOneBidChangeWeek', 'toggleRoundOneBidChangeDate', 'roundOneBidChangeValidationMessage']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), context);
}
const row = (key, group, request=key) => ({ oldKey:key, newKey:'', groupKey:group, itemKey:request });
context.bidChangeRows = [row('2027-06-07','2027-06-07'), row('2027-06-09','2027-06-07'), row('2027-06-11','2027-06-07'), row('2027-06-21','2027-06-21')];
context.selectRoundOneBidChangeWeek('2027-06-07');
assert.equal(context.bidChangeCount(), 0);
context.toggleRoundOneBidChangeDate('2027-06-09');
let draft = context.bidChangeDraftSelection();
assert.deepEqual(Array.from(draft.replacementRows, r=>r.newKey), ['2027-06-07','2027-06-11']);
assert.equal(draft.affectedRequestIds.size, 3);
assert.ok(!draft.affectedRequestIds.has('2027-06-21'));
assert.equal(context.roundOneBidChangeValidationMessage(), '');
context.toggleRoundOneBidChangeDate('2027-06-08');
assert.ok(context.bidChangeWeek.dates.has('2027-06-08'));
context.toggleRoundOneBidChangeDate('2027-06-12'); // RDO
context.toggleRoundOneBidChangeDate('2027-06-14'); // outside span
assert.ok(!context.bidChangeWeek.dates.has('2027-06-12'));
assert.ok(!context.bidChangeWeek.dates.has('2027-06-14'));
context.updateRoundOneBidChangeWeek('2027-06-07','2027-07-09');
assert.equal(context.bidChangeWeek.dates.size, 0);
assert.match(context.roundOneBidChangeValidationMessage(), /at least one/);
for (const key of ['2027-07-09','2027-07-12','2027-07-14']) context.toggleRoundOneBidChangeDate(key);
assert.equal(context.roundOneBidChangeValidationMessage(), '');
assert.deepEqual([...context.bidChangeWeek.dates], ['2027-07-09','2027-07-12','2027-07-14']);
context.updateRoundOneBidChangeWeek('2027-06-07','2027-06-20');
context.toggleRoundOneBidChangeDate('2027-06-22');
assert.match(context.roundOneBidChangeValidationMessage(), /overlaps/);
context.bidChangeRows[0].itemKey = 'shared';
context.bidChangeRows[3].itemKey = 'shared';
context.selectRoundOneBidChangeWeek('2027-06-07');
context.toggleRoundOneBidChangeDate('2027-06-09');
assert.ok(context.bidChangeDraftSelection().replacementRows.some(r => r.newKey === '2027-06-21'), 'legacy shared requests preserve other-week dates');
context.leaveManagementPendingId = 'saving';
const before = [...context.bidChangeWeek.dates];
context.toggleRoundOneBidChangeDate('2027-06-08');
assert.deepEqual([...context.bidChangeWeek.dates], before);
context.bidChangeRound = 2;
context.bidChangeRows = [row('2027-06-07','')];
context.bidChangeRows[0].newKey = '2027-06-08';
assert.equal(context.bidChangeDraftSelection().replacementRows[0].newKey, '2027-06-08');
console.log('PASS whole-week date editing: gaps, deletions, RDOs, span limits, other-week preservation, save lock, later rounds');
// Render the actual editor to check accessible selection states and RDO controls.
const elements = new Map();
context.document = { querySelector: selector => {
  if (!elements.has(selector)) elements.set(selector, {});
  return elements.get(selector);
} };
context.escapeHtml = value => String(value);
context.BID_YEAR = 2027;
context.setBidChangeStatus = () => {};
context.bidChangeValidationMessage = () => '';
for (const name of ['bidChangeDateLabel', 'renderRoundOneBidChangeModal']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), context);
}
context.leaveManagementPendingId = '';
context.bidChangeRound = 1;
context.bidChangeRows = [row('2027-06-07','2027-06-07'), row('2027-06-09','2027-06-07'), row('2027-06-21','2027-06-21')];
context.selectRoundOneBidChangeWeek('2027-06-07');
context.toggleRoundOneBidChangeDate('2027-06-09');
const target = {}, save = {};
context.renderRoundOneBidChangeModal(target, save);
assert.match(target.innerHTML, /data-bid-change-toggle-date="2027-06-12"[^>]*disabled/);
assert.match(target.innerHTML, /data-bid-change-toggle-date="2027-06-07" aria-pressed="true"/);
assert.match(target.innerHTML, /data-bid-change-toggle-date="2027-06-09" aria-pressed="false"/);
assert.equal(save.disabled, false);
assert.equal(save.textContent, 'Review & Save Week');
console.log('PASS rendered week picker, RDO disabled states, deselection and whole-week save');
