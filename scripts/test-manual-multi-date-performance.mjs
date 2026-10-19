import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n}', start) + 2); };
const target = { hidden: true, innerHTML: '' };
const fields = {
  '[data-manual-multi-picker]': target,
  '[data-manual-bid-controller]': { value: 'DM' },
  '[data-manual-bid-area]': { value: 'Area A' },
  '[data-manual-leave-round]': { value: '2' },
};
for (const name of ['start', 'end', 'days']) fields[`[data-manual-leave-${name}]`] = { closest: () => ({ hidden: false }) };
const panel = { querySelector: key => fields[key], querySelectorAll: () => [] };
let cacheActive = false;
let countPasses = 0;
const context = vm.createContext({
  BID_YEAR: 2027, currentUser: { initials: 'ADMIN' },
  manualLeaveBatch: { key: '', entries: [] },
  currentViewArea: () => 'Area A', currentRoundNumber: () => 2,
  escapeHtml: value => value,
  withLeaveReadCache: fn => { cacheActive = true; try { return fn(); } finally { cacheActive = false; } },
  isRdoDateForInitials: (key, initials) => { assert.equal(initials, 'DM'); assert.ok(cacheActive); return new Date(`${key}T12:00:00`).getDay() === 0; },
  isHolidayDate: () => false,
  // These must never run on a date click.
  manualBidPerson: () => ({ initials: 'DM', bidAs: 'CPC' }),
  manualLeaveDateChecks: (_person, _area, keys) => new Map(keys.map(key => [key, {rdo:false, full:false} ])),
  renderApp: () => { throw Error('Date clicks must not refresh the app'); },
  fetch: () => { throw Error('Date clicks must not access the network'); },
});
vm.runInContext(['manualLeaveBatchKey', 'manualDatePickerState', 'renderManualDatePicker', 'dateKey', 'dateFromKey', 'dateKeyFromDate', 'datesInLeaveRange', 'chargeableLeaveDateKeys'].map(extract).join('\n'), context);
const actualCount = context.chargeableLeaveDateKeys;
context.chargeableLeaveDateKeys = (...args) => { countPasses++; return actualCount(...args); };
const state = context.manualDatePickerState(panel);
state.mode = 'multiple'; state.month = 5;
const samples = [];
for (let run = 0; run < 50; run++) {
  state.dates.clear();
  for (let day = 1; day <= 10; day++) {
    state.dates.add(`2027-06-${String(day).padStart(2, '0')}`);
    const start = performance.now();
    context.renderManualDatePicker(panel);
    samples.push(performance.now() - start);
  }
}
assert.equal(countPasses, 500, 'One charge calculation per render');
assert.match(target.innerHTML, /10 selected · 9 charged days/);
assert.match(target.innerHTML, /aria-pressed="true"/);
samples.sort((a, b) => a - b);
const p95 = samples[Math.floor(samples.length * .95)];
assert.ok(p95 < 50, `Picker HTML generation p95 ${p95.toFixed(2)}ms exceeds 50ms budget`);
console.log(`PASS 500 picker renders: HTML generation p95 ${p95.toFixed(2)}ms; max ${samples.at(-1).toFixed(2)}ms (sample RDO rules; excludes browser layout and live-data cost)`);
