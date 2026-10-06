import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('const referenceLoadDiagnostics = []'), source.indexOf('\nfunction dateFromKey'))
const ok = data => ({ data, error: null, status: 200 })
const failure = status => ({ data: null, error: { code: 'TEST_FAILURE' }, status })
function setup({ catalogFails = false, rosterFails = false, helpGate } = {}) {
  const applied = new Set()
  const state = { authUserId: '', loading: false }
  const client = {
    rpc: async name => name === 'read_bidding_roster' && rosterFails ? failure(403) : ok([]),
    from: name => {
      const value = name === 'bid_years' ? { id: 'year' } : [{ id: 'area', name: 'Area A' }]
      const builder = { then: resolve => Promise.resolve(ok(value)).then(resolve) }
      for (const method of ['select', 'eq', 'single', 'order']) builder[method] = () => builder
      return builder
    },
  }
  const context = vm.createContext({
    console: { warn() {} }, window: {}, AbortController,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 ? 30 : 0), clearTimeout,
    liveDataSnapshots: new Map(), supabaseState: state, publicFaqContent: {}, BID_YEAR: 2027, calendarRenderRevision: 0,
    supabaseClient: () => client, resetSupabaseBackedData() {},
    loadBidYearCatalog: async () => { if (catalogFails) throw Error('catalog failed') },
    isMemberAppVisible: () => false, renderPublicPage: () => applied.add('render'),
    loadRdoLines: async () => ok([]), loadPublishedLeaveSlots: async () => ok([]),
    loadPublishedGlRdoAssignments: async () => ok([]), loadIntakeSchedules: async () => ok([]),
    loadPublishedBidWindows: async () => ok([]), loadSupabaseHelpThreads: () => helpGate || Promise.resolve(),
    hasIntakeAccess: () => false, supabaseRows: result => result.data || [],
    supabaseLoadWarning: (name, result) => result.error ? name : null,
    isMissingSupabaseRoutine: () => false, isMissingSupabaseColumn: () => false,
    holidayOverrides: new Set(), intakeCalendarMarks: new Map(),
    applyRosterFromDatabase: () => applied.add('roster'),
    upsertRdoLinesFromDatabase: () => applied.add('rdo'),
    applyLeaveSlotScheduleFromDatabase: () => applied.add('calendar'),
    applyBidWindowsFromDatabase: () => applied.add('bid times'),
    applyGlRdoAssignments() {}, applyGhostBiddingStatus() {}, applyIntakeSchedulesFromDatabase() {},
    applyBidYearSettings() {}, applyRoundRules() {}, applyApprovalRules() {},
    upsertRdoSubmissionsFromDatabase() {}, upsertLeaveRequestsFromDatabase() {},
    attachSubmissionIdsToLeaveRequests: rows => rows, attachLeaveRequestWeekBuckets: async (_, rows) => rows,
  })
  vm.runInContext(code, context)
  return { context, state, applied }
}

const { context } = setup()
let calls = 0
await context.readReferenceData('transient', () => ++calls < 3 ? failure(503) : ok([]))
assert.equal(calls, 3)
calls = 0
await context.readReferenceData('permission', () => { calls++; return failure(403) })
assert.equal(calls, 1)
calls = 0
await context.readReferenceData('network', () => { calls++; throw new TypeError('Failed to fetch') })
assert.equal(calls, 3)
let aborted = 0
await context.readReferenceData('timeout', () => ({
  abortSignal(signal) { signal.addEventListener('abort', () => aborted++) },
  then() {},
}))
assert.equal(aborted, 3)
assert.equal(context.window.NATCA_REFERENCE_LOAD_DIAGNOSTICS.at(-1).code, 'READ_TIMEOUT')
// Simulate simultaneous readers without sending traffic to production.
await Promise.all(Array.from({ length: 100 }, (_, i) => {
  let attempts = 0
  return context.readReferenceData(`reader ${i}`, () => ++attempts === 1 ? failure(503) : ok([]))
}))
assert.equal(context.window.NATCA_REFERENCE_LOAD_DIAGNOSTICS.length, 50)
assert.deepEqual(Object.keys(context.window.NATCA_REFERENCE_LOAD_DIAGNOSTICS[0]).sort(), ['section', 'attempt', 'status', 'code', 'elapsedMs', 'at', 'retrying'].sort())

const catalog = setup({ catalogFails: true })
await catalog.context.loadSupabaseReferenceData()
assert.equal(catalog.state.faqLoadState, 'loaded')
assert.equal(catalog.state.rdoLinesLoadState, 'error')

let releaseHelp
const helpGate = new Promise(resolve => { releaseHelp = resolve })
const partial = setup({ rosterFails: true, helpGate })
const loading = partial.context.loadSupabaseReferenceData()
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(partial.state.loading, true)
assert.equal(partial.state.faqLoadState, 'loaded')
assert.equal(partial.state.rdoLinesLoadState, 'loaded')
assert.equal(partial.state.leaveSlotsLoadState, 'loaded')
assert.equal(partial.state.bidTimesLoadState, 'error')
assert.ok(partial.applied.has('rdo'))
assert.ok(partial.applied.has('calendar'))
releaseHelp()
await loading
assert.equal(partial.state.connected, true)
const complete = setup()
await complete.context.loadSupabaseReferenceData()
assert.equal(complete.state.bidTimesLoadState, 'loaded')
console.log('Reference loading: retries, permissions, timeouts, independent sections, partial failures, and 100 concurrent readers passed.')
