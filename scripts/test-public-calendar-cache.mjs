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
  document: { getElementById: () => target, querySelectorAll: () => [] },
  window: { matchMedia: () => ({ matches: false }) },
  publicState: { area: 'Area A' }, currentUser: { area: 'Area A' },
  calendarRenderRevision: 1, publicCalendarCacheRevision: -1,
  publicCalendarCache: new Map(), ZLA_AREAS: ['Area A', 'Area B'],
  memberCalendarCache: new Map(), memberCalendarCacheRevision: -1,
  currentViewArea: () => 'Area A',
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
assert.ok(context.publicCalendarCache.size <= 12);
for (const id of ['public-calendar', 'dashboard-calendar', 'leave-calendar']) {
  const scope = id === 'public-calendar' ? 'public' : id === 'dashboard-calendar' ? 'dashboard' : 'leave';
  context.calendarRenderRevision++;
  context.calendarLayouts[scope] = 'minimal';
  const draw = () => context.makeCalendar(id, { reuseCurrent: true });
  const before = builds;
  for (const mode of ['leave', 'fatigue', 'combined', 'leave', 'fatigue', 'combined']) {
    context.calendarMode = mode;
    draw();
  }
  assert.equal(builds - before, 3, `${id}: repeat mode switches use cached views`);
  context.calendarLayouts[scope] = 'full';
  draw();
  assert.equal(builds - before, 4, `${id}: full layout builds once`);
  context.calendarLayouts[scope] = 'minimal';
  draw();
  assert.equal(builds - before, 4, `${id}: minimal layout is reused`);
  context.calendarRenderRevision++;
  draw();
  assert.equal(builds - before, 5, `${id}: data changes invalidate every view`);
}
const refreshStart = source.indexOf('function refreshMemberCalendarDatesWithCache(');
vm.runInNewContext(source.slice(refreshStart, source.indexOf('\n}', refreshStart) + 2), context);
context.refreshMemberCalendarDatesWithCache([]);
assert.equal(context.memberCalendarCache.size, 0, 'Local date edits discard saved member views');
context.calendarMode = 'leave';
context.makeCalendar('leave-calendar', { reuseCurrent: true });
assert.ok(context.memberCalendarCache.size > 0, 'Invalidated hidden views rebuild');
console.log('PASS public/dashboard/leave view reuse, database and local-edit invalidation, and cache bound');
