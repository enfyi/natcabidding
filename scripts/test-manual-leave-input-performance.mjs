import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let cached = false;
let calculations = 0;
const fields = {
  '[data-manual-leave-days]': { value: '', hasAttribute: () => true },
  '[data-manual-bid-controller]': { value: 'ME' },
  '[data-manual-leave-round]': { value: '2' },
};
const panel = { querySelector: selector => fields[selector] };
let range = 'June 7–11';
const context = vm.createContext({
  currentUser: { initials: 'ADMIN' }, currentRoundNumber: () => 1,
  withLeaveReadCache: read => {
    cached = true;
    try { return read(); } finally { cached = false; }
  },
  manualLeaveRangeFromDateInputs: () => range,
  chargeableLeaveDatesForInitials: (value, initials, round) => {
    assert.equal(cached, true);
    assert.equal(initials, 'ME', 'Use the selected bidder, not the administrator');
    assert.equal(round, 2);
    assert.equal(value, range);
    calculations++;
    return ['2027-06-07', '2027-06-10', '2027-06-11'];
  },
});
vm.runInContext(fn('updateManualLeaveDays'), context);
context.updateManualLeaveDays(panel);
assert.equal(fields['[data-manual-leave-days]'].value, 3);
range = '';
context.updateManualLeaveDays(panel);
assert.equal(fields['[data-manual-leave-days]'].value, '');
assert.equal(calculations, 1, 'Empty dates do not run leave calculations');
fields['[data-manual-leave-days]'].hasAttribute = () => false;
fields['[data-manual-leave-days]'].value = '4';
context.updateManualLeaveDays(panel);
assert.equal(fields['[data-manual-leave-days]'].value, '4', 'Manual day counts remain unchanged');
let rendered = false;
context.renderManualBidPanelWithCache = candidate => {
  assert.equal(candidate, panel);
  assert.equal(cached, true, 'Initials selection shares roster and holiday calculations');
  rendered = true;
};
vm.runInContext(fn('renderManualBidPanel'), context);
context.renderManualBidPanel(panel);
assert.equal(rendered, true);
const render = fn('renderManualBidPanelWithCache');
assert.match(render, /if \(!isLeave\) \{[\s\S]*fatigueCapacityForLine/);
const input = source.slice(source.indexOf('const manualLeaveDateField ='), source.indexOf('const intakeSearch =', source.indexOf('const manualLeaveDateField =')));
assert.match(input, /updateManualLeaveDays\(manualPanel\)/);
assert.doesNotMatch(input, /renderManualBidPanel/);
const change = source.slice(source.indexOf('if (manualPanel && manualReactiveField)'), source.indexOf('const rdoFilter =', source.indexOf('if (manualPanel && manualReactiveField)')));
assert.match(change, /data-manual-leave-start\], \[data-manual-leave-end\][\s\S]*updateManualLeaveDays\(manualPanel\);\s+return;/);
console.log('PASS manual leave date edits update only charged days, preserve selected bidder/round, and initials rendering uses the read cache');
