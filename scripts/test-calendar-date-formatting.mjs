import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function formatCalendarDate(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
const formatterStart = source.indexOf('const calendarDateFormatter =');
const formatter = source.slice(formatterStart, source.indexOf('\n});', formatterStart) + 4);
let constructions = 0;
const context = vm.createContext({ Intl: { DateTimeFormat: function(...args) { constructions++; return new Intl.DateTimeFormat(...args); } } });
vm.runInContext(formatter + '\n' + fn, context);
const dates = [];
for (const year of [2026, 2027, 2028]) {
  for (let i = 0; i < 366; i++) {
    const date = new Date(year, 0, i + 1);
    if (date.getFullYear() !== year) break;
    dates.push(`${year}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
  }
}
const original = key => {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday:'short', month:'short', day:'numeric' }).format(new Date(year, month-1, day));
};
for (const key of dates) assert.equal(context.formatCalendarDate(key), original(key), key);
assert.equal(constructions, 1, 'One formatter across all calendar dates and years');
const measure = format => {
  const start = performance.now();
  for (let i = 0; i < 365; i++) format(dates[i]);
  return performance.now() - start;
};
const before = measure(original), after = measure(context.formatCalendarDate);
console.log(`PASS identical labels for ${dates.length} dates, including leap day; one formatter. 365-date sample: ${before.toFixed(2)} ms → ${after.toFixed(2)} ms`);
const mapStart = source.indexOf('function leaveSlotMapUncached(');
const mapFn = source.slice(mapStart, source.indexOf('\n}', mapStart) + 2);
context.currentUser = { area: 'Area A' };
context.leaveSlotWeeks = [];
context.extraLeaveSlotData = Object.fromEntries(dates.slice(0,365).map(date => [date, { date, area:'Area A', cpc:['AB'], dev:[], cpcCapacity:3, devCapacity:4 }]));
context.slotMatchesArea = (day, area) => day.area === area;
vm.runInContext(mapFn, context);
const first = context.leaveSlotMapUncached('Area A');
assert.equal(Object.keys(first).length, 365);
for (const key of Object.keys(first)) assert.equal(first[key].label, original(key));
context.extraLeaveSlotData[dates[0]].cpc = ['CD'];
assert.deepEqual([...context.leaveSlotMapUncached('Area A')[dates[0]].cpc], ['CD'], 'Reusing the formatter never caches availability');
console.log('PASS full area map labels and fresh slot availability');
