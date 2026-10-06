import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let editing = false, member = true, renders = 0, applies = 0, reads = 0, release;
let row = 'first', fail = false, wait = false;
const timers = new Map();
const state = { connected: true, bidYearId: 'year-id', authUserId: 'bidder', loading: false };
const ctx = vm.createContext({
  console: { warn() {} }, URL, supabaseState: state, BID_YEAR: 2027,
  document: { visibilityState: 'visible' }, window: { scrollX: 0, scrollY: 120, scrollTo(x, y) { assert.equal(y, 120); } },
  setTimeout: action => { const id = {}; timers.set(id, action); return id; }, clearTimeout: id => timers.delete(id),
  supabaseClient: () => ({ from: () => ({ select: () => Promise.resolve({ data: [{ id: 'area', name: 'Area A' }] }) }) }),
  readReferenceData: async (_label, request) => request(),
  isMemberAppVisible: () => member, hasActiveLiveDataEditing: () => editing,
  liveDataLocalSnapshot: () => row, captureLiveDataControls: () => new Map(), restoreLiveDataControls() {},
  renderApp: () => { renders++; }, renderPublicPage: () => { renders++; },
  readLiveDataGroup: async () => {
    reads++;
    const snapshot = row;
    if (wait) await new Promise(resolve => { release = resolve; });
    if (fail) return { results: [{ error: { message: 'offline' } }] };
    return { results: [{ data: snapshot }], apply: () => { applies++; } };
  },
});
vm.runInContext(`const liveDataTables = { bidding: [], roster: [], slots: [] };
let liveDataTimer = null, liveDataRunning = false, liveDataGeneration = 0, liveDataActivityRevision = 0;
const liveDataDirtyGroups = new Set(), liveDataSnapshots = new Map();
let calendarRenderRevision = 0;
` + ['scheduleLiveDataRefresh','stopLiveDataUpdates','refreshLiveData'].map(fn).join('\n'), ctx);
ctx.scheduleLiveDataRefresh(['bidding']);
ctx.scheduleLiveDataRefresh(['bidding']);
assert.equal(timers.size, 1, 'Events debounce into one timer');
editing = true;
await ctx.refreshLiveData();
assert.equal(reads, 0, 'Active editing defers database reads');
editing = false;
await ctx.refreshLiveData();
assert.equal(applies, 1);
assert.equal(renders, 1);
ctx.scheduleLiveDataRefresh(['bidding']);
await ctx.refreshLiveData();
assert.equal(renders, 1, 'Identical snapshots never redraw');
row = 'second';
ctx.scheduleLiveDataRefresh(['bidding']);
wait = true;
const pending = ctx.refreshLiveData();
for (let i = 0; i < 20; i++) await Promise.resolve();
assert.equal(typeof release, 'function');
await ctx.refreshLiveData();
assert.equal(reads, 3, 'Concurrent refreshes share one read');
vm.runInContext('liveDataActivityRevision++', ctx);
release(); await pending;
assert.equal(applies, 1, 'Reads overtaken by user interaction are discarded');
wait = false;
await ctx.refreshLiveData();
assert.equal(applies, 2, 'Deferred updates eventually apply');
fail = true;
row = 'third';
ctx.scheduleLiveDataRefresh(['bidding']);
await ctx.refreshLiveData();
assert.equal(applies, 2, 'Failed reads preserve the last good data');
assert.equal(vm.runInContext('liveDataRunning', ctx), false);
fail = false; wait = true;
const oldSession = ctx.refreshLiveData();
for (let i = 0; i < 20; i++) await Promise.resolve();
ctx.stopLiveDataUpdates();
state.authUserId = 'other';
release(); await oldSession;
assert.equal(applies, 2, 'Logout/session replacement discards in-flight results');
assert.equal(vm.runInContext('liveDataDirtyGroups.size', ctx), 0);
wait = false; member = false;
ctx.scheduleLiveDataRefresh(['roster']);
await ctx.refreshLiveData();
assert.equal(renders, 3, 'Public pages also receive background updates');
ctx.document.visibilityState = 'hidden';
ctx.scheduleLiveDataRefresh(['roster']);
const beforeHidden = reads;
await ctx.refreshLiveData();
assert.equal(reads, beforeHidden, 'Hidden tabs do no background reads');

let finishFetch;
const fetchCtx = vm.createContext({ URL, liveDataWritesPending: 0, liveDataActivityRevision: 0,
  scheduleLiveDataRefresh() {}, window: { fetch: async () => new Promise(resolve => { finishFetch = resolve; }) } });
vm.runInContext(fn('fetchWithLiveUpdateTracking'), fetchCtx);
const read = fetchCtx.fetchWithLiveUpdateTracking('https://example.supabase.co/rest/v1/rpc/read_round_rules', { method: 'POST' });
assert.equal(fetchCtx.liveDataWritesPending, 0, 'Read-only POST RPCs are not treated as writes');
finishFetch({ ok: true }); await read;
const save = fetchCtx.fetchWithLiveUpdateTracking('https://example.supabase.co/rest/v1/rpc/review_bidding_submission', { method: 'POST' });
assert.equal(fetchCtx.liveDataWritesPending, 1, 'Every mutation blocks background application');
finishFetch({ ok: true }); await save;
assert.equal(fetchCtx.liveDataWritesPending, 0);
assert.equal(fetchCtx.liveDataActivityRevision, 2, 'A completed save invalidates older responses');
fetchCtx.window.fetch = async () => { throw Error('offline'); };
await assert.rejects(fetchCtx.fetchWithLiveUpdateTracking('https://example.supabase.co/rest/v1/bidders', { method: 'PATCH' }));
assert.equal(fetchCtx.liveDataWritesPending, 0, 'Failed mutations release their lock');

function control(tag, value, data, type = 'text') {
  return { tagName: tag, value, type, name: '', id: '', checked: false,
    attributes: Object.entries(data).map(([name, value]) => ({ name, value })) };
}
let controls = [control('INPUT', 'unsaved', { 'data-roster-name': '' }), control('SELECT', 'A', { 'data-rdo-area': '' })];
controls[1].options = [{ value: 'A' }, { value: 'B' }];
const forms = vm.createContext({ document: { querySelectorAll: () => controls } });
vm.runInContext(['liveDataControlKey','captureLiveDataControls','restoreLiveDataControls'].map(fn).join('\n'), forms);
const saved = forms.captureLiveDataControls();
controls[0].value = 'server value'; controls[1].value = 'B';
forms.restoreLiveDataControls(saved);
assert.equal(controls[0].value, 'unsaved', 'Redraw preserves unsaved form values after blur');
assert.equal(controls[1].value, 'A', 'Redraw preserves filter selection');
controls[1].options = [{ value: 'B' }]; controls[1].value = 'B';
forms.restoreLiveDataControls(saved);
assert.equal(controls[1].value, 'B', 'Deleted options are not restored');

// Exercise the real bidding group: removed lines disappear and drafts survive.
const lines = [{ id: 'deleted', line: 'OLD' }], drafts = [{ id: 'draft' }];
const bidding = vm.createContext({
  BID_YEAR: 2027, supabaseState: { bidYearId: 'year' },
  readReferenceData: async (_label, request) => request(),
  loadRdoLines: async () => ({ data: [{ id: 'new', line: 'NEW' }] }),
  loadPublishedGlRdoAssignments: async () => ({ data: [] }),
  rdoLines: lines, leaveBids: [{ supabaseRequestId: 'deleted-request' }, ...drafts],
  intakeQueue: [{ supabaseSubmissionId: 'deleted-submission' }],
  intakeBidderSelection: { record: {}, generation: 0 },
  upsertRdoLinesFromDatabase: rows => lines.push(...rows), applyGlRdoAssignments() {},
  upsertRdoSubmissionsFromDatabase() {}, upsertLeaveRequestsFromDatabase() {},
  attachLeaveRequestWeekBuckets: async (_client, rows) => rows,
  attachSubmissionIdsToLeaveRequests: rows => rows,
  biddingStateSubmissionType: row => row.type, supabaseRows: result => result.data || [],
  lastAlertDatabaseSnapshot: 'old',
});
vm.runInContext(fn('readLiveDataGroup'), bidding);
const update = await bidding.readLiveDataGroup('bidding', { rpc: async () => ({ data: [] }) }, new Map(), true);
update.apply();
assert.deepEqual(lines.map(line => line.id), ['new']);
assert.deepEqual(bidding.leaveBids, drafts, 'Database replacement preserves local drafts');
assert.equal(bidding.intakeQueue.length, 0, 'Deleted submissions disappear');
console.log('Live bidding updates regression checks passed.');

const handlers = new Map();
let connectedCallback, alertRefreshes = 0, dataRefreshes = [];
const tableStart = source.indexOf('const liveDataTables = {');
const tableEnd = source.indexOf('\n};', tableStart) + 3;
const listener = vm.createContext({
  supabaseState: { authUserId: 'one' }, alertRealtimeUserId: '', alertRealtimeChannel: null,
  supabaseClient: () => ({ channel: () => ({
    on(_event, filter, callback) { handlers.set(filter.table, callback); return this; },
    subscribe(callback) { connectedCallback = callback; },
  }) }),
  stopLiveAlertUpdates() {},
  scheduleLiveAlertRefresh: () => alertRefreshes++,
  scheduleLiveDataRefresh: groups => dataRefreshes.push(groups),
  refreshActiveBidYear() {},
});
vm.runInContext(source.slice(tableStart, tableEnd) + '\n' + fn('startLiveAlertUpdates'), listener);
listener.startLiveAlertUpdates();
for (const table of ['bidders', 'rdo_lines', 'rdo_line_days', 'bid_windows', 'leave_slots', 'intake_schedules', 'bid_rounds', 'faq_entries']) {
  assert.ok(handlers.has(table), `${table} is subscribed`);
}
handlers.get('leave_requests')();
assert.deepEqual(Array.from(dataRefreshes.at(-1)), ['bidding','slots','windows'], 'A bid event invalidates dependent availability');
handlers.get('bidders')();
assert.ok(dataRefreshes.at(-1).includes('windows'), 'Roster changes also refresh related bid windows');
connectedCallback('SUBSCRIBED');
assert.equal(alertRefreshes, 1);
assert.equal(dataRefreshes.at(-1), undefined, 'Reconnect reconciles all groups');

ctx.window.NATCA_SUPABASE_CONFIG = { environment: 'pilot' };
ctx.document.visibilityState = 'visible';
state.connected = false; state.bidYearId = ''; state.referenceDataLoaded = true;
ctx.stopLiveDataUpdates();
ctx.scheduleLiveDataRefresh();
assert.deepEqual(Array.from(vm.runInContext('[...liveDataDirtyGroups]', ctx)), ['slots'], 'Signed-out pilot only refreshes its public calendar');
await ctx.refreshLiveData();
assert.equal(vm.runInContext('liveDataDirtyGroups.size', ctx), 0, 'Public pilot does not require direct bid-year table access');
console.log('Realtime subscription coverage and public pilot fallback checks passed.');
