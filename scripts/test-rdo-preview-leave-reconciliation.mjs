import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8')
const helperStart = source.indexOf('function rdoWeekdaysForLine(')
const helperEnd = source.indexOf('function reconcileUnsubmittedLeaveForRdoLine(', helperStart)

assert.ok(helperStart >= 0 && helperEnd > helperStart, 'RDO/leave compatibility helpers were found')

const context = {
  dateFromKey: (key) => new Date(`${key}T12:00:00`),
  Set,
}
vm.createContext(context)
vm.runInContext(source.slice(helperStart, helperEnd), context)

const sundayWednesdayRdo = { week: ['RDO', 'D', 'D', 'RDO', 'D', 'D', 'D'] }
assert.equal(context.leaveDateConflictsWithRdoLine('2027-01-03', sundayWednesdayRdo), true)
assert.equal(context.leaveDateConflictsWithRdoLine('2027-01-06', sundayWednesdayRdo), true)
assert.equal(context.leaveDateConflictsWithRdoLine('2027-01-07', sundayWednesdayRdo), false)

assert.match(source, /function reconcileUnsubmittedLeaveForRdoLine\(line\)/)
assert.match(source, /leaveDraftQueue = nextDrafts/)
assert.match(source, /selectedLeaveDates\.delete\(key\)/)
assert.match(source, /unsubmitted leave \$\{removedDates === 1 \? "date was" : "dates were"\} removed/)
assert.match(source, /if \(selectedLineId !== previousLineId && !submittedRdoLineForInitials\(currentUser\.initials\)\)/)
assert.match(source, /renderMemberCalendarForPage\(pageName\)/)
assert.doesNotMatch(
  source.slice(source.indexOf('const row = event.target.closest("[data-line-id]")'), source.indexOf('const leaveDateButton', source.indexOf('const row = event.target.closest("[data-line-id]")'))),
  /renderCalendars|renderLeaveSlotBoard/,
)

console.log('PASS RDO preview changes prune conflicting unsubmitted leave without rebuilding hidden calendars')
