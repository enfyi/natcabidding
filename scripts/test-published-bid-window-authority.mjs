import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const lookup = source.slice(source.indexOf('function bidWindowForRankRound('), source.indexOf('function currentUserSeniorityRank('))
const reader = source.slice(source.indexOf('async function loadPublishedBidWindows('), source.indexOf('async function loadPublishedLeaveSlots('))
const saved = { round: 1, start: new Date('2026-10-05T14:00:00Z'), end: new Date('2026-10-05T16:00:00Z') }
let result = saved
const context = vm.createContext({
  currentViewArea: () => 'Area A',
  databaseBidWindowForRankRound: () => result,
  supabaseState: { authUserId: null },
  BID_YEAR: 2027,
})
vm.runInContext(lookup + reader, context)
assert.equal(context.bidWindowForRankRound(1, 1), saved, 'Saved October 5 window must be used unchanged')
result = null
assert.equal(context.bidWindowForRankRound(1, 1), null, 'Loading, missing, or failed windows must not produce October 1 times')

let response = { data: [saved], error: null }
const client = {
  async rpc(name, args) {
    assert.equal(name, 'read_public_bid_windows')
    assert.equal(args.requested_bid_year, 2027)
    return response
  },
  from() { throw new Error('Signed-out users must use the public reader') },
}
assert.equal(await context.loadPublishedBidWindows(client, 'year-id'), response)
response = { data: null, error: { message: 'Temporary network failure' } }
assert.equal(await context.loadPublishedBidWindows(client, 'year-id'), response)
assert.equal(context.bidWindowForRankRound(1, 1), null)
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const windows = new Map();
const now = new Date('2026-10-16T14:30:00Z');
const row = { bidder_id: 'employee', round_number: 2,
  opens_at: '2026-10-16T14:00:00Z', closes_at: '2026-10-16T16:00:00Z' };
let responseData = { data: [row], error: null };
let renders = 0;
const state = { connected: true, bidYearId: 'year-id', authUserId: 'employee', loading: false };
const lifecycle = vm.createContext({
  Date, console, BID_YEAR: 2027, databaseBidWindows: windows, supabaseState: state,
  databaseBidWindowKey: (id, round) => `${id}|${round}`,
  buildSeniority: () => [],
  currentUserBidWindow: () => windows.get('employee|2') || null,
  pilotState: { database: false }, isViewingHomeArea: () => true,
  selectedBidYearErrorMessage: () => '', bidWindowLockIsBypassed: () => false,
  document: { visibilityState: 'visible' },
  window: { scrollX: 0, scrollY: 0, scrollTo() {} },
  setTimeout: () => 1, clearTimeout() {},
  supabaseClient: () => ({ from: () => ({ select: async () => ({ data: [], error: null }) }) }),
  readReferenceData: async (_name, request) => request(),
  isMemberAppVisible: () => true, hasActiveLiveDataEditing: () => false,
  liveDataLocalSnapshot: () => windows.size,
  extraLeaveSlotData: {}, captureLiveDataControls: () => new Map(), restoreLiveDataControls() {},
  renderLiveDataSections: () => { renders++; },
  readLiveDataGroup: async () => ({ results: [responseData],
    apply: () => lifecycle.applyPublishedBidWindowResult(responseData) }),
});
vm.runInContext(`let seniority = [];
const liveDataTables = { windows: [] };
let liveDataTimer = null, liveDataRunning = false, liveDataGeneration = 0, liveDataActivityRevision = 0;
const liveDataDirtyGroups = new Set(), liveDataSnapshots = new Map(), liveDataLastReadAt = new Map();
` + ['supabaseRows', 'applyBidWindowsFromDatabase', 'applyPublishedBidWindowResult',
  'currentUserBidWindowStatus', 'scheduleLiveDataRefresh', 'readLiveDataGroupWithTimeout', 'refreshLiveData'].map(fn).join('\n'), lifecycle);

// Initial/foreground loading must discard prior assignments on failure.
lifecycle.applyPublishedBidWindowResult(responseData);
assert.equal(lifecycle.currentUserBidWindowStatus(now).isOpen, true);
lifecycle.applyPublishedBidWindowResult({ data: [row], error: { message: 'offline' } });
assert.equal(windows.size, 0, 'Even an error response with data cannot retain obsolete windows');
assert.equal(state.bidTimesLoadState, 'error');
assert.equal(lifecycle.currentUserBidWindowStatus(now).isOpen, false, 'Failed loading disables bidder controls');
assert.equal(lifecycle.currentUserBidWindowStatus(now).window, null, 'Countdowns cannot use the old assignment');

// Exercise the actual background refresh path and retry with identical rows.
lifecycle.scheduleLiveDataRefresh(['windows']);
await lifecycle.refreshLiveData();
assert.equal(lifecycle.currentUserBidWindowStatus(now).isOpen, true);
responseData = { data: null, error: { message: 'offline' } };
lifecycle.scheduleLiveDataRefresh(['windows']);
await lifecycle.refreshLiveData();
assert.equal(windows.size, 0, 'Background failure also clears obsolete assignments');
assert.equal(state.bidTimesLoadState, 'error');
assert.equal(lifecycle.currentUserBidWindowStatus(now).isOpen, false);
responseData = { data: [row], error: null };
await lifecycle.refreshLiveData();
assert.equal(state.bidTimesLoadState, 'loaded');
assert.equal(lifecycle.currentUserBidWindowStatus(now).isOpen, true, 'Identical saved rows restore access after retry');
assert.equal(renders, 3, 'Failure and recovery redraw the window consumers');
assert.match(source, /applyPublishedBidWindowResult\(result\)/, 'Foreground loading uses the tested result handler');
console.log('PASS published windows, failed foreground/background reads, disabled controls, and identical-schedule recovery');
