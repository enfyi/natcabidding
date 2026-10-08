import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function makeCalendar(');
const makeCalendar = source.slice(start, source.indexOf('\n}', start) + 2);
let builds = 0;
const node = () => ({ cloneNode: () => node() });
const target = {
  dataset: {}, childNodes: [],
  get childElementCount() { return this.childNodes.length; },
  set innerHTML(value) { this.childNodes = [node()]; },
  replaceChildren(...nodes) { this.childNodes = nodes; },
  closest: () => null,
  classList: { remove() {}, toggle() {} },
};
const context = {
  document: { getElementById: () => target },
  window: { matchMedia: () => ({ matches: false }) },
  publicState: { area: 'Area A' }, currentUser: { area: 'Area A' },
  calendarRenderRevision: 1, publicCalendarCacheRevision: -1,
  publicCalendarCache: new Map(), ZLA_AREAS: ['Area A', 'Area B'],
  displayedCalendarYear: 2027, calendarMode: 'leave', calendarLayouts: {},
  monthNames: Array(12).fill('month'),
  calendarWorkforceForScope: () => 'cpc',
  syncMobileCalendarControls() {}, syncMobileCalendarMonths() {},
  makeCalendarRenderContext() { builds++; return {}; },
  renderMonthCard: () => '<month/>', renderLeaveYearContinuation: () => '',
};
vm.runInNewContext(makeCalendar, context);
const render = () => context.makeCalendar('public-calendar', { reuseCurrent: true });
render();
render();
assert.equal(builds, 1, 'Returning from a tab reuses the current calendar');
context.publicState.area = 'Area B';
render();
context.publicState.area = 'Area A';
render();
assert.equal(builds, 2, 'Returning to an area reuses its cached calendar');
context.calendarRenderRevision++;
render();
assert.equal(builds, 3, 'Fresh database data invalidates cached calendars');
context.calendarLayouts.public = 'full';
render();
assert.equal(builds, 4, 'Layout changes rebuild the calendar');
context.displayedCalendarYear++;
render();
assert.equal(builds, 5, 'Year changes rebuild the calendar');
assert.ok(context.publicCalendarCache.size <= context.ZLA_AREAS.length);
console.log('PASS public calendar reuse, data invalidation, view changes, and cache bound');
