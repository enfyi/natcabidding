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
const setPageSource = source.slice(source.indexOf('function setPage('), source.indexOf('function updateSelectedBidYear('))
assert.match(setPageSource, /renderMemberCalendarForPage\(pageName,\s*\{\s*defer: activePageName !== pageName && needsFullRender,\s*\}\)/)

// Exercise the deferred renderer so the test protects page-transition behavior.
const frames = new Map()
const renders = []
let frameId = 0
let activePage = 'leave'
let busy = false
const calendarContext = vm.createContext({
  document: { querySelector: () => ({ dataset: { pagePanel: activePage } }) },
  window: {
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: id => frames.delete(id),
  },
  memberCalendarForPage: () => ({
    setAttribute: () => { busy = true },
    removeAttribute: () => { busy = false },
  }),
  renderCalendars: options => renders.push(options),
})
const renderStart = source.indexOf('function renderMemberCalendarForPage(')
const renderEnd = source.indexOf('function refreshMemberCalendarDates(', renderStart)
vm.runInContext('let pendingPageCalendarFrame = 0;\n' + source.slice(renderStart, renderEnd), calendarContext)
function flushFrame() {
  const [id, callback] = frames.entries().next().value
  frames.delete(id)
  callback()
}
calendarContext.renderMemberCalendarForPage('leave', { defer: true })
assert.equal(busy, true)
assert.equal(renders.length, 0)
flushFrame()
assert.equal(renders.length, 0, 'Wait for the page transition before rendering')
flushFrame()
assert.equal(renders.length, 1)
assert.equal(renders[0].includePublic, false)
assert.equal(renders[0].reuseCurrent, true, 'Reuse calendars already at the current revision')
assert.equal(busy, false)
calendarContext.renderMemberCalendarForPage('leave', { defer: true })
activePage = 'rdos'
flushFrame()
flushFrame()
assert.equal(renders.length, 1, 'Do not render a calendar after navigating away')
activePage = 'leave'
calendarContext.renderMemberCalendarForPage('leave', { defer: true })
calendarContext.renderMemberCalendarForPage('leave')
assert.equal(frames.size, 0, 'Cancel obsolete deferred work')
assert.equal(renders.length, 2, 'Current page can render immediately')
assert.doesNotMatch(
  source.slice(source.indexOf('const row = event.target.closest("[data-line-id]")'), source.indexOf('const leaveDateButton', source.indexOf('const row = event.target.closest("[data-line-id]")'))),
  /renderCalendars|renderLeaveSlotBoard/,
)

console.log('PASS RDO preview changes prune conflicting unsubmitted leave without rebuilding hidden calendars')
