import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const names = ['isHolidayDate', 'isHolidayInLieuDate', 'leaveSlotsForDateFromMap'];
const functions = names.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');
const holiday = '2027-01-01';
const context = vm.createContext({
  currentUser: null,
  isLegalHolidayDate: key => key === holiday,
  formatCalendarDate: key => key,
  federalHolidayDatesForYear: (year, initials) => {
    assert.equal(initials, 'AB');
    return new Set(['2027-01-02']);
  },
  holidayInLieuDatesForYear: (year, initials) => {
    assert.equal(initials, 'AB');
    return new Set(['2027-01-02']);
  },
});
vm.runInContext(functions, context);
for (const slots of [{}, { [holiday]: { date: holiday, cpc: ['AB'], dev: [] } }]) {
  const details = context.leaveSlotsForDateFromMap(holiday, 'Area A', slots);
  assert.equal(details.holiday, true);
  assert.equal(details.holidayInLieu, false);
  assert.equal(context.leaveSlotsForDateFromMap('2027-01-02', 'Area A', slots).holiday, false);
}
context.currentUser = { initials: 'AB' };
assert.equal(context.isHolidayDate('2027-01-02'), true);
assert.equal(context.isHolidayInLieuDate('2027-01-02'), true);
assert.equal(context.isHolidayDate(holiday), false);
console.log('PASS anonymous calendar slot loading and signed-in holiday lookup');
