import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function jumpToCalendarMonth(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
for (const id of ['public-calendar', 'dashboard-calendar', 'leave-calendar']) {
  for (const preserveMobilePosition of [false, true]) {
    const scrolls = [], aligned = [], frames = [];
    const cards = [2, 7].map(month => ({ month, classList: { toggle() {} }, scrollIntoView: () => aligned.push(month) }));
    const target = { id, style: {}, classList: { contains: () => true }, querySelectorAll: () => cards, getBoundingClientRect: () => ({ height: 800 }) };
    const context = vm.createContext({
      window: { scrollY: 6000, matchMedia: () => ({ matches: true }), scrollTo: value => scrolls.push(value) },
      document: { querySelector: () => ({ value: '' }) },
      calendarNavigationIndex: card => card.month,
      renderProgressiveCalendarMonths() {}, updateCalendarMonthNavigation() {}, scheduleProgressiveCalendar() {},
      requestAnimationFrame: fn => frames.push(fn),
    });
    vm.runInContext(fn, context);
    context.jumpToCalendarMonth(target, 7, { preserveMobilePosition });
    frames.forEach(frame => frame());
    if (preserveMobilePosition) {
      assert.equal(scrolls[0].top, 6000, `${id}: month arrows retain their position`);
      assert.deepEqual(aligned, []);
    } else {
      assert.deepEqual(scrolls, [], `${id}: annual toggle must not restore the full-year scroll offset`);
      assert.deepEqual(aligned, [7, 7], `${id}: selected month aligned immediately and after layout`);
    }
  }
}
console.log('PASS annual collapse aligns the selected month in all three calendars; month stepping retains its position');
