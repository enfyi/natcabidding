import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function makeProgressiveCalendar(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
for (const id of ['public-calendar', 'dashboard-calendar', 'leave-calendar']) {
  for (const reuseCurrent of [false, true]) {
    const cards = Array.from({ length: 13 }, (_, index) => ({
      index, dataset: index < 9 ? {} : { calendarPending: '' },
      hasAttribute() { return 'calendarPending' in this.dataset; },
      setAttribute() {},
    }));
    const target = { id, dataset: {}, querySelectorAll: () => cards,
      set innerHTML(value) { assert.fail(`${id}: refresh must retain month shells and page height`); } };
    const states = new WeakMap([[target, { renderKey: 'same-view', year: 2027, revision: 1 }]]);
    const rendered = [];
    let synced = false;
    const context = vm.createContext({
      progressiveCalendars: states, calendarRenderRevision: 2, displayedCalendarYear: 2027,
      calendarNavigationIndex: card => card.index, cancelProgressiveCalendar() {},
      renderProgressiveCalendarMonths(element, indexes) {
        assert.equal(element, target);
        rendered.push(...indexes);
        indexes.forEach(index => { delete cards[index].dataset.calendarPending; });
      },
      syncMobileCalendarMonths(element) { assert.equal(element, target); synced = true; },
    });
    vm.runInContext(fn, context);
    context.makeProgressiveCalendar(target, 'same-view', {}, new Map(), reuseCurrent);
    assert.deepEqual(rendered, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(cards[9].hasAttribute('data-calendar-pending'), true);
    assert.equal(target.dataset.calendarRevision, '2');
    assert.equal(synced, true);
  }
}
console.log('PASS all three calendars retain loaded month shells during forced and cached refreshes');
