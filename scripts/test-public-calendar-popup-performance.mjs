import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let labels = 0;
const dates = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2027, 0, i + 1)).toISOString().slice(0, 10));
const slots = Object.fromEntries(dates.map(date => [date, { date, area: 'Area A', cpc: ['AB'], dev: [], cpcCapacity: 3, devCapacity: 4, cpcOpen: 2, devOpen: 4 }]));
const context = vm.createContext({
  currentUser: { area: 'Area A' }, leaveSlotWeeks: [], extraLeaveSlotData: slots,
  slotMatchesArea: (day, area) => day.area === area,
  formatCalendarDate: key => { labels++; return key; },
});
vm.runInContext(fn('leaveSlotMapUncached'), context);
const full = context.leaveSlotMapUncached('Area A');
assert.equal(labels, 365);
labels = 0;
const single = context.leaveSlotMapUncached('Area A', dates[30]);
assert.deepEqual(single[dates[30]], full[dates[30]]);
assert.equal(Object.keys(single).length, 1);
assert.equal(labels, 1, 'Format only the tapped date instead of the full year');
assert.equal(Object.keys(context.leaveSlotMapUncached('Area B', dates[30])).length, 0);
slots[dates[30]].cpc = ['CD'];
assert.deepEqual([...context.leaveSlotMapUncached('Area A', dates[30])[dates[30]].cpc], ['CD'], 'Next tap sees refreshed data');
context.leaveSlotWeeks = [{ group: 'B', round: 1, days: [{ date: dates[31], area: 'TMU', cpc: ['TM'] }, { date: dates[32], area: 'TMU' }] }];
assert.equal(context.leaveSlotMapUncached('TMU', dates[31])[dates[31]].group, 'B');
assert.equal(Object.keys(context.leaveSlotMapUncached('TMU', dates[31])).length, 1);

let shown = 0;
const content = { innerHTML: '' };
const sheet = { querySelector: () => content, showModal: () => shown++ };
const popup = vm.createContext({
  withLeaveReadCache: read => read(), publicState: { area: 'Area A' },
  leaveSlotMapUncached: (area, key) => { assert.equal(area, 'Area A'); assert.equal(key, dates[30]); return single; },
  visibleLeaveSlotDetailsFromMap: (key, area, map, options) => {
    assert.equal(options.includePrivateOverlays, false);
    assert.equal(map, single);
    return single[key];
  },
  document: { querySelector: () => sheet, getElementById: () => ({ textContent: '' }) },
  formatCalendarDate: key => key, dateFromKey: key => new Date(key),
  leaveSlotDataIsLoaded: () => true,
  calendarHolidayKind: (key, options) => { assert.equal(options.showRdo, false); assert.equal(options.showPersonalLeave, false); return null; },
  escapeHtml: value => value,
  leaveSlotCapacityForDetails: (details, bucket) => details[`${bucket}Capacity`],
  leaveSlotOpenCountForDetails: (details, bucket) => details[`${bucket}Open`],
  leaveSlotLoadingMessage: () => 'Loading leave slots…',
});
vm.runInContext(fn('openPublicDateSheet') + '\n' + fn('openPublicDateSheetWithCache'), popup);
popup.openPublicDateSheet({ dataset: { publicLeaveDate: dates[30] } });
assert.equal(shown, 1);
assert.match(content.innerHTML, /CPC · 2 open/);
assert.match(content.innerHTML, /AB/);
assert.match(content.innerHTML, /Developmental · 4 open/);
popup.leaveSlotDataIsLoaded = () => false;
popup.openPublicDateSheet({ dataset: { publicLeaveDate: dates[30] } });
assert.match(content.innerHTML, /Loading leave slots/);
assert.equal(shown, 2);
console.log('PASS public popup: 365 → 1 date formats per tap, fresh area data, public overlays, slot counts, and loading state');
