import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const names = ['withLeaveReadCache', 'cachedLeaveRead', 'submittedRdoLineForInitials',
  'rdoLineForInitials', 'rdoWeekdaysForLine', 'firstRdoWeekdayForInitials',
  'isRdoWeekdayForInitials', 'inLieuHolidayKey', 'legalHolidayDatesForYear',
  'legalHolidayDatesForYearUncached', 'holidayInLieuDatesForYear',
  'holidayInLieuDatesForYearUncached', 'federalHolidayDatesForYear',
  'federalHolidayDatesForYearUncached', 'isHolidayInLieuDate', 'isHolidayDate',
  'holidayInLieuIsProvisional', 'isLegalHolidayDate', 'calendarHolidayKind', 'nthWeekdayOfMonth', 'lastWeekdayOfMonth'];
const context = {
  currentUser: { initials: 'ME', area: 'A' }, intakeQueue: [],
  rdoLines: [
    { line: 'MON', week: ['D','RDO','D','D','D','D','RDO'] },
    { line: 'TUE', week: ['D','D','RDO','D','D','D','RDO'] },
  ],
  supabaseState: { connected: true }, holidayOverrides: [],
  bueByInitials: () => ({ area: 'A' }), lineForArea: () => true,
  dateKey: (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
  dateFromKey: key => new Date(`${key}T12:00:00`),
  dateKeyFromDate: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
};
vm.createContext(context);
vm.runInContext('let leaveReadCache = null;\n' + names.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}',start)+2);
}).join('\n'), context);
const kind = key => context.withLeaveReadCache(() => context.calendarHolidayKind(key));
assert.equal(kind('2027-06-01'), null, 'No line means no personal in-lieu date');
context.intakeQueue = [{ type: 'RDO Line', initials: 'ME', area: 'A', line: 'MON', status: 'Pending' }];
assert.match(kind('2027-06-01').label, /provisional.*pending RDO approval/);
assert.equal(kind('2027-05-31'), null, 'Holiday on pending RDO moves to June 1');
assert.equal(context.calendarHolidayKind('2027-05-31', {showRdo:false,showPersonalLeave:false}).label, 'Holiday', 'Public calendar keeps legal holidays');
context.intakeQueue[0].status = 'Approved';
assert.equal(kind('2027-06-01').label, 'Holiday In-Lieu');
context.intakeQueue[0].status = 'Pending';
context.intakeQueue[0].line = 'TUE';
assert.equal(kind('2027-06-01'), null, 'Changing line removes stale in-lieu date');
assert.equal(kind('2027-05-31').label, 'Holiday');
context.intakeQueue[0].line = 'MON';
context.intakeQueue[0].status = 'Rejected';
assert.equal(kind('2027-06-01'), null, 'Rejected line removes provisional date');
context.rdoLines[0].cpc = 'ME';
context.rdoLines[0].status = 'Taken';
assert.equal(kind('2027-06-01').label, 'Holiday In-Lieu', 'Assigned line remains final');
console.log('PASS pending, approved, changed, rejected, assigned, and public holiday calendars');
