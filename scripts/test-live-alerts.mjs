import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const refresh = source.slice(source.indexOf('let alertRefreshPending ='), source.indexOf('function primeAlertSound()'))
for (const role of ['user', 'admin', 'intaker']) {
  let renders = 0
  let calls = 0
  let fail = false
  let release
  const context = vm.createContext({
    document: { visibilityState: 'visible', querySelector: () => null, querySelectorAll: () => [] },
    isMemberAppVisible: () => true,
    supabaseState: { authUserId: 'account', connected: true, loading: false },
    BID_YEAR: 2027,
    intakeQueue: [{ id: 'removed', supabaseSubmissionId: 'removed', status: 'Pending' }],
    helpThreads: [], currentUser: { initials: 'AB' }, lastAudibleAlertCount: null,
    hasIntakeAccess: () => role !== 'user',
    pendingIntakeItems: () => context.intakeQueue.filter(item => item.status === 'Pending'),
    bidTypeLabel: () => 'RDO', setText: () => { renders++ }, playAlertDing: () => {}, escapeHtml: value => value,
    currentHelpRequester: () => ({ sessionId: 'session' }), liveHelpSessionId: () => 'session',
    supabaseClient: () => ({
      rpc: async name => {
        calls++
        if (release) await new Promise(resolve => { release.resolve = resolve })
        if (fail) throw new Error('offline')
        if (name === 'read_bidding_state') return { data: { submissions: [{ id: 'new', type: 'RDO Line', status: 'pending', initials: 'AB' }] } }
        if (name === 'read_leave_intake_queue') return { data: [] }
        return { data: [{ id: 'help', initials: 'AB', status: 'Answered' }] }
      },
      from: () => ({ select: async () => ({ data: [] }) }),
    }),
    biddingStateSubmissionType: row => row.type,
    attachLeaveRequestWeekBuckets: async (_, rows) => rows,
    attachSubmissionIdsToLeaveRequests: rows => rows,
    supabaseRdoSubmissionToIntakeItem: row => ({ ...row, supabaseSubmissionId: row.id, status: 'Pending' }),
    inferRdoBidChanges: () => {}, upsertLeaveRequestsFromDatabase: () => {}, helpThreadFromRpc: row => row,
    console: { warn: () => {} },
  })
  vm.runInContext(refresh, context)
  await vm.runInContext('refreshLiveAlerts()', context)
  assert.equal(context.intakeQueue[0].id, 'new')
  assert.equal(context.intakeQueue.length, 1)
  assert.equal(context.helpThreads[0].id, 'help')
  assert.ok(renders > 0)
  assert.equal(vm.runInContext('alertItems().length', context), 2)
  const before = JSON.stringify(context.intakeQueue)
  fail = true
  await vm.runInContext('refreshLiveAlerts()', context)
  assert.equal(JSON.stringify(context.intakeQueue), before)
  fail = false
  context.document.visibilityState = 'hidden'
  const beforeCalls = calls
  await vm.runInContext('refreshLiveAlerts()', context)
  assert.equal(calls, beforeCalls)
  context.document.visibilityState = 'visible'
  release = {}
  // Hold only the bidding RPC to simulate a slow request.
  const original = context.supabaseClient
  context.supabaseClient = () => {
    const client = original()
    return { ...client, rpc: name => name === 'read_bidding_state'
      ? new Promise(resolve => { release.resolve = () => resolve({ data: { submissions: [] } }) })
      : Promise.resolve({ data: [] }) }
  }
  const pending = vm.runInContext('refreshLiveAlerts()', context)
  await vm.runInContext('refreshLiveAlerts()', context)
  context.supabaseState.authUserId = 'different-account'
  release.resolve()
  await pending
  assert.equal(JSON.stringify(context.intakeQueue), before)
}
assert.match(source, /setInterval\(\(\) => \{ void refreshLiveAlerts\(\); \}, 60000\)/)
assert.match(source, /window.addEventListener\("online"/)
console.log('Live alerts: user, admin, intaker, removals, failures, hidden tabs, overlapping reads, and session changes passed.')

// Verify one subscription per account and one fetch for a burst of events.
let subscriptions = 0
let removed = 0
let nextTimer = 0
const timers = new Map()
const listeners = []
const channel = {
  on: (_, options, callback) => { listeners.push({ options, callback }); return channel },
  subscribe: callback => { subscriptions++; callback('SUBSCRIBED'); return channel },
}
const realtime = vm.createContext({
  supabaseState: { authUserId: 'first' },
  supabaseClient: () => ({ channel: () => channel, removeChannel: () => { removed++ } }),
  setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer },
  clearTimeout: id => timers.delete(id),
})
vm.runInContext(refresh.slice(0, refresh.indexOf('async function refreshLiveAlerts()')), realtime)
let refreshes = 0
realtime.refreshLiveAlerts = () => { refreshes++ }
vm.runInContext('startLiveAlertUpdates(); startLiveAlertUpdates()', realtime)
assert.equal(subscriptions, 1)
assert.deepEqual(listeners.map(item => item.options.table), ['intake_submissions', 'leave_requests', 'help_threads', 'help_messages'])
for (const { callback } of listeners) callback()
assert.equal(timers.size, 1)
for (const [id, fn] of [...timers]) { timers.delete(id); fn() }
assert.equal(refreshes, 1)
realtime.supabaseState.authUserId = 'second'
vm.runInContext('startLiveAlertUpdates()', realtime)
assert.equal(subscriptions, 2)
assert.equal(removed, 1)
vm.runInContext('stopLiveAlertUpdates()', realtime)
assert.equal(removed, 2)
assert.equal(timers.size, 0)
console.log('Realtime subscriptions, event batching, account changes, and cleanup passed.')
