import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function showPublicCalendarTooltip(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
let mobile = false, expanded = false, reads = 0, previous = null;
const calendar = {
  classList: { contains: () => expanded },
  querySelectorAll: () => previous ? [previous] : [],
};
const button = key => ({
  dataset: { publicLeaveDate: key }, tooltip: null,
  closest: () => calendar,
  querySelector() { return this.tooltip; },
  insertAdjacentHTML(position, html) {
    assert.equal(position, 'beforeend');
    this.tooltip = { remove: () => { this.tooltip = null; } };
    this.html = html;
    previous = this;
  },
});
const context = vm.createContext({
  window: { matchMedia: () => ({ matches: mobile }) },
  publicState: { area: 'Area B' },
  withLeaveReadCache: fn => fn(),
  leaveSlotMapUncached: (area, key) => { reads++; return { area, key, revision: reads }; },
  visibleLeaveSlotDetailsFromMap: (key, area, map, options) => {
    assert.equal(options.includePrivateOverlays, false);
    assert.equal(map.key, key); assert.equal(map.area, area);
    return map;
  },
  calendarHolidayKind: (key, options) => {
    assert.equal(options.showRdo, false); assert.equal(options.showPersonalLeave, false);
    return 'holiday';
  },
  quickLeaveSlotTooltip: (key, holiday, area, details) => `${area}/${key}/${details.revision}/${holiday}`,
});
vm.runInContext(fn, context);
const first = button('2027-01-10'), second = button('2027-01-11');
context.showPublicCalendarTooltip(first);
assert.match(first.html, /Area B\/2027-01-10\/1\/holiday/);
context.showPublicCalendarTooltip(first);
assert.equal(reads, 1, 'Moving within a date reuses its tooltip');
context.showPublicCalendarTooltip(second);
assert.equal(first.tooltip, null, 'Only the active date retains generated markup');
assert.equal(first.dataset.lazySlotTooltip, undefined);
context.showPublicCalendarTooltip(first);
assert.match(first.html, /\/3\/holiday/, 'Revisiting a date reads current availability');
mobile = true; context.showPublicCalendarTooltip(second);
mobile = false; expanded = true; context.showPublicCalendarTooltip(second);
assert.equal(reads, 3, 'Mobile sheets and full layout do not create lazy tooltips');
assert.match(source, /document.addEventListener\("pointerover"/);
assert.match(source, /document.addEventListener\("focusin"/);
console.log('PASS lazy public tooltips: selected-date reads, bounded DOM, current availability, public overlays, mobile/full guards');
