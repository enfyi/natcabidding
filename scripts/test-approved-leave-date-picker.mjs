import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
const context = vm.createContext({ BID_YEAR: 2027, Intl, Date });
for (const name of ['dateKey', 'dateFromKey', 'dateKeyFromDate', 'escapeHtml', 'datesInLeaveRange', 'formatLeaveRangeFromKeys', 'renderApprovedLeaveDatePicker', 'syncApprovedLeaveDatePicker']) vm.runInContext(extract(name), context);
const html = context.renderApprovedLeaveDatePicker({ range: 'Jul 12 - 16, 2027' });
assert.match(html, /type="date" value="2027-07-12"/);
assert.match(html, /type="date" value="2027-07-16"/);
const fields = {
  '[data-override-start]': { value: '2027-07-19', validity: { valid: true } },
  '[data-override-end]': { value: '2027-07-23', validity: { valid: true } },
  '[data-override-range]': {}, '[data-override-date-preview]': {}, '[data-override-date-error]': {},
  '[data-intake-save-override]': { toggleAttribute(name, value) { this[name] = value; } },
};
const editor = { querySelector: selector => fields[selector] };
assert.equal(context.syncApprovedLeaveDatePicker(editor), true);
assert.equal(fields['[data-override-range]'].value, 'Jul 19 - 23, 2027');
assert.equal(context.datesInLeaveRange(fields['[data-override-range]'].value).length, 5);
fields['[data-override-end]'].value = '2027-07-19';
assert.equal(context.syncApprovedLeaveDatePicker(editor), true);
assert.equal(fields['[data-override-range]'].value, 'Jul 19, 2027');
for (const [value, valid] of [['2027-07-18', true], ['', true], ['2028-01-01', false]]) {
  fields['[data-override-end]'].value = value;
  fields['[data-override-end]'].validity.valid = valid;
  assert.equal(context.syncApprovedLeaveDatePicker(editor), false);
  assert.equal(fields['[data-override-range]'].value, '');
  assert.equal(fields['[data-intake-save-override]'].disabled, true);
}
fields['[data-override-end]'] = { value: '2027-08-02', validity: { valid: true } };
assert.equal(context.syncApprovedLeaveDatePicker(editor), true);
assert.equal(fields['[data-intake-save-override]'].disabled, false);
assert.equal(context.datesInLeaveRange(fields['[data-override-range]'].value).at(-1), '2027-08-02');
console.log('PASS approved leave calendar prefill, single-day/range serialization, invalid-date blocking, and recovery');
