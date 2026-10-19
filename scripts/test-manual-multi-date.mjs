import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); };
const fields = {
  '[data-manual-bid-controller]': { get value() { return initials; } },
  '[data-manual-bid-area]': { value: 'Area A' },
  '[data-manual-leave-round]': { value: '2' },
  '[data-manual-leave-notes]': { value: ' phone bid ' },
};
const panel = { querySelector: key => fields[key] };
let initials = 'DM';
const context = vm.createContext({
  BID_YEAR: 2027, manualBidPerson: () => ({ initials }), currentViewArea: () => 'Area A',
  formatLeaveRangeFromKeys: keys => keys.join(','), manualLeaveRangeValue: () => 'range',
});
vm.runInContext(['manualLeaveBatchKey', 'manualDatePickerState', 'manualLeaveDraftEntries'].map(extract).join('\n'), context);
const state = context.manualDatePickerState(panel);
state.mode = 'multiple';
for (const date of ['2027-07-15', '2027-06-07', '2028-01-08', '2027-06-07']) state.dates.add(date);
const entries = context.manualLeaveDraftEntries(panel);
assert.deepEqual(Array.from(entries, e => e.range), ['2027-06-07', '2027-07-15', '2028-01-08']);
assert.ok(entries.every(e => e.notes === 'phone bid'));
state.mode = 'range';
assert.equal(context.manualLeaveDraftEntries(panel)[0].range, 'range');
state.mode = 'multiple';
initials = 'OTHER';
assert.equal(context.manualDatePickerState(panel).dates.size, 0, 'Changing bidder clears unbatched dates');
assert.equal(context.manualDatePickerState(panel).mode, 'multiple');
context.manualDatePickerState(panel).dates.add('2027-06-07');
fields['[data-manual-leave-round]'].value = '3';
assert.equal(context.manualDatePickerState(panel).dates.size, 0, 'Changing round clears unbatched dates');
fields['[data-manual-bid-area]'].value = 'Area B';
assert.equal(context.manualDatePickerState(panel).dates.size, 0);
const render = extract('renderManualDatePicker');
assert.doesNotMatch(render, /renderApp\(|fetch\(|supabase\./, 'Date selection stays local');
assert.match(source, /Add your selected dates to the batch before submitting/);
const startField = { value: '2027-06-07' };
const endField = { value: '' };
const rangePanel = { querySelector: key => key === '[data-manual-leave-start]' ? startField : endField };
context.formatLeaveRangeFromKeys = keys => keys.join(',');
vm.runInContext(['defaultManualLeaveEndDate', 'manualLeaveRangeFromDateInputs'].map(extract).join('\n'), context);
context.defaultManualLeaveEndDate(rangePanel);
assert.equal(endField.value, startField.value, 'Picking only a start date defaults to a single day');
assert.equal(context.manualLeaveRangeFromDateInputs(rangePanel), '2027-06-07');
endField.value = '2027-06-10';
assert.equal(context.manualLeaveRangeFromDateInputs(rangePanel), '2027-06-07,2027-06-10');
console.log('PASS multi-date drafts preserve scattered dates across years, remove duplicates, retain range entry, and reset with bidder context');
