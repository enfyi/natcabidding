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
  extraLeaveSlotData: {}, renderLiveDataSections: () => { renders++; },
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
const liveDataDirtyGroups = new Set(), liveDataSnapshots = new Map(), liveDataLastReadAt = new Map();
let calendarRenderRevision = 0;
` + ['scheduleLiveDataRefresh','stopLiveDataUpdates','readLiveDataGroupWithTimeout','refreshLiveData'].map(fn).join('\n'), ctx);
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
  loadLeaveRequestsWithWeeks: async () => ({ data: [] }),
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
assert.equal(alertRefreshes, 0, "Reconnect uses a single refresh queue");
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

// Fallback checks are staggered, and successful realtime reads reset their clock.
vm.runInContext(fn('liveDataFallbackGroups'), listener);
vm.runInContext('const liveDataLastReadAt = new Map(Object.keys(liveDataTables).map(group => [group, 1000000]));', listener);
assert.deepEqual(Array.from(listener.liveDataFallbackGroups(1060000)), ['bidding','slots','windows','help']);
assert.ok(listener.liveDataFallbackGroups(1300000).includes('schedules'));
assert.ok(!listener.liveDataFallbackGroups(1300000).includes('faq'));
assert.equal(listener.liveDataFallbackGroups(1600000).length, 8);

// Help does not touch calendars; availability patches only dates with changed data.
let page = 'calendar';
const calls = [], target = { childElementCount: 1, dataset: { calendarRevision: '0' } };
const rendering = vm.createContext({
  withLeaveReadCache: action => action(), calendarRenderRevision: 0,
  document: { querySelector: () => ({ dataset: { pagePanel: page } }) },
  extraLeaveSlotData: { a: { date: '2027-01-01', cpc: ['AB'] }, b: { date: '2027-01-02', cpc: [] } },
  renderMemberCalendarForPage: () => calls.push('full-calendar'),
  renderAlerts: () => calls.push('alerts'), renderHelpSummary: () => calls.push('help-summary'),
  renderHelpPanel: () => calls.push('help-panel'), renderLeaveSlotBoard: () => calls.push('slots'),
  refreshMemberCalendarDates: dates => calls.push(Array.from(dates)), memberCalendarForPage: () => target,
});
vm.runInContext(fn('renderLiveDataSections'), rendering);
rendering.renderLiveDataSections(new Set(['help']), true, {});
assert.deepEqual(calls, ['alerts','help-summary','help-panel']);
calls.length = 0;
rendering.renderLiveDataSections(new Set(['slots']), true, {
  a: { date: '2027-01-01', cpc: [] }, b: { date: '2027-01-02', cpc: [] },
  c: { date: '2027-01-03', cpc: ['CD'] },
});
assert.deepEqual(calls, ['slots', ['2027-01-01','2027-01-03']], 'Includes removed dates and skips unchanged dates');
assert.equal(target.dataset.calendarRevision, '1');
console.log('Staggered fallback and targeted rendering checks passed.');

calls.length = 0;
target.dataset.calendarRevision = '-1';
rendering.renderLiveDataSections(new Set(['slots']), true, {});
assert.deepEqual(calls, ['slots', 'full-calendar'], 'A stale calendar rebuilds before date patches can mark it current');

// HZ left selected in manual entry must not freeze arrivals or notifications.
let intakeActive = true;
const guard = vm.createContext({
  document: { querySelector: selector => selector.includes('page.active') && intakeActive ? {} : null },
  hasActiveIntakeEditing: () => true, bidderEditor: { busy: false },
  intakeDecisionPending: false, intakeDecisionRefreshRunning: false,
  intakeScheduleMutationPending: false, shiftPresetMutationPending: false,
  leaveManagementPendingId: null, intakeLeaveRemovalPendingId: null,
  pilotBidderResetPending: false, biddingBackupBusy: false, liveDataWritesPending: 0,
});
vm.runInContext(fn('hasActiveLiveDataEditing'), guard);
assert.equal(guard.hasActiveLiveDataEditing(), false, 'Dirty manual panel does not block intake reads');
guard.liveDataWritesPending = 1;
assert.equal(guard.hasActiveLiveDataEditing(), true, 'Actual saves still block stale reads');
guard.liveDataWritesPending = 0;
intakeActive = false;
assert.equal(guard.hasActiveLiveDataEditing(), true, 'Other page editing remains protected');
page = 'intake';
rendering.hasActiveIntakeEditing = () => true;
rendering.renderLiveIntakeQueue = () => calls.push('queue');
calls.length = 0;
rendering.renderLiveDataSections(new Set(['bidding']), true, {});
assert.deepEqual(calls, ['alerts', 'queue'], 'New arrivals update alerts and queue without rebuilding HZ manual entry');

let deadline, lateResolve;
const stalled = vm.createContext({
  setTimeout: callback => { deadline = callback; return 1; }, clearTimeout() {},
  readLiveDataGroup: () => new Promise(resolve => { lateResolve = resolve; }),
});
vm.runInContext(fn('readLiveDataGroupWithTimeout'), stalled);
const blocked = stalled.readLiveDataGroupWithTimeout('bidding');
deadline();
const timeout = await blocked;
assert.equal(timeout.results[0].error.code, 'LIVE_READ_TIMEOUT');
let lateApplies = 0;
lateResolve({ results: [{ data: [] }], apply: () => lateApplies++ });
await Promise.resolve();
assert.equal(lateApplies, 0, 'A late read cannot overwrite newer data');
console.log('PASS idle manual selection, notifications, editor safety and stalled-read recovery');

for (const panelName of ['RDO Selection', 'Requested Leave Dates']) {
  const panel = { dataset: {}, closest: selector => selector === '.page.active' ? {} : null };
  const formGuard = vm.createContext({
    document: { activeElement: null, querySelectorAll: () => [panel],
      querySelector: selector => selector.includes('page.active') ? {} : null },
    activeOverrideId: null, activeDenialId: null, bidderEditor: { busy: false },
    intakeDecisionPending: false, intakeDecisionRefreshRunning: false,
    intakeScheduleMutationPending: false, shiftPresetMutationPending: false,
    leaveManagementPendingId: null, intakeLeaveRemovalPendingId: null,
    pilotBidderResetPending: false, biddingBackupBusy: false, liveDataWritesPending: 0,
  });
  vm.runInContext(['markIntakeEditing', 'hasActiveIntakeEditing', 'hasActiveLiveDataEditing'].map(fn).join('\n'), formGuard);
  formGuard.markIntakeEditing({ target: { closest: () => panel } });
  assert.equal(formGuard.hasActiveIntakeEditing(), true, `${panelName} draft remains protected`);
  assert.equal(formGuard.hasActiveLiveDataEditing(), false, `${panelName} draft allows queue and notification reads while idle`);
}

for (const scenario of [
  { name: 'Intake queue search', focused: true },
  { name: 'Queue filter or sort', focused: true },
  { name: 'Edit Bidder Info search', focused: true },
  { name: 'Edit Bidder Info unsaved changes', focused: true, editor: true, dirty: true },
  { name: 'Read Approval Rules' },
  { name: 'Read Round Rules' },
  { name: 'Open override', override: 'bid' },
  { name: 'Open denial', denial: 'bid' },
]) {
  const panel = { dataset: { approvalRefreshDirty: scenario.dirty ? 'true' : '' },
    closest: selector => selector === '.page.active' ? {} : null };
  const audit = vm.createContext({
    document: {
      activeElement: { matches: () => Boolean(scenario.focused),
        closest: selector => selector === '.page.active' ||
          (selector.includes('data-manual-bid-panel') && scenario.editor) ? {} : null },
      querySelectorAll: () => [panel],
      querySelector: selector => selector.includes('page.active') ? {} : null,
    },
    activeOverrideId: scenario.override || null, activeDenialId: scenario.denial || null,
    bidderEditor: { busy: false }, intakeDecisionPending: false, intakeDecisionRefreshRunning: false,
    intakeScheduleMutationPending: false, shiftPresetMutationPending: false,
    leaveManagementPendingId: null, intakeLeaveRemovalPendingId: null,
    pilotBidderResetPending: false, biddingBackupBusy: false, liveDataWritesPending: 0,
  });
  vm.runInContext(['hasActiveIntakeEditing', 'hasActiveLiveDataEditing'].map(fn).join('\n'), audit);
  assert.equal(audit.hasActiveLiveDataEditing(), false, `${scenario.name} allows intake notifications`);
}
console.log('PASS intake search, filters, bidder edits, rules, override and denial notification guards');

// Exact RDO lookup flow: select HZ, display Bidding Employee, then receive a bid.
let employeeRenders = 0, detailLoads = 0;
const selectedBidder = { initials: 'HZ', profileId: 'hz-profile', record: null, generation: 0, loading: false };
const selection = vm.createContext({
  intakeBidderSelection: selectedBidder,
  bueByInitials: initials => initials === 'HZ' ? { initials: 'HZ', profileId: 'hz-profile' } : null,
  renderIntakeBidderSummary: () => employeeRenders++,
  loadSelectedIntakeBidder: async () => { detailLoads++; selectedBidder.record = { displayed: true }; },
});
vm.runInContext(fn('selectIntakeBidder'), selection);
selection.selectIntakeBidder(' hz ');
assert.equal(selectedBidder.initials, 'HZ');
assert.equal(employeeRenders, 1, 'Selecting an RDO bidder displays Bidding Employee information');
assert.equal(detailLoads, 1);
intakeActive = true;
assert.equal(guard.hasActiveLiveDataEditing(), false, 'Displayed employee information does not pause reads');
calls.length = 0;
rendering.renderLiveDataSections(new Set(['bidding']), true, {});
assert.deepEqual(calls, ['alerts', 'queue'], 'New notifications and queue items render with the selected employee displayed');
assert.equal(selectedBidder.initials, 'HZ', 'Incoming bids preserve the selected RDO employee');
console.log('PASS RDO bidder lookup followed by incoming notifications and queue refresh');

// A read-only calendar date popup is not a bid editor.
intakeActive = true;
let openDialog = 'date-detail';
guard.document.querySelector = selector => {
  if (selector.includes('page.active')) return {};
  if (openDialog === 'date-detail') return selector.includes(':not([data-leave-slot-modal])') ? null : {};
  return {};
};
assert.equal(guard.hasActiveLiveDataEditing(), false, 'Leave Slot Detail permits incoming notifications');
openDialog = 'bid-change';
assert.equal(guard.hasActiveLiveDataEditing(), true, 'Editable bid-change dialogs retain their protection');
console.log('PASS read-only calendar popup updates and editable dialog protection');

for (const interaction of ['start date focused', 'end date focused', 'unfinished consecutive range', 'round changed', 'notes edited', 'range added to batch']) {
  const panel = { dataset: { approvalRefreshDirty: 'true' }, closest: selector => selector === '.page.active' ? {} : null };
  const range = vm.createContext({
    document: { activeElement: { matches: () => true,
      closest: selector => selector === '.page.active' || selector.includes('data-manual-bid-panel') ? {} : null },
      querySelectorAll: () => [panel], querySelector: selector => selector.includes('page.active') ? {} : null },
    activeOverrideId: null, activeDenialId: null, bidderEditor: { busy: false },
    intakeDecisionPending: false, intakeDecisionRefreshRunning: false,
    intakeScheduleMutationPending: false, shiftPresetMutationPending: false,
    leaveManagementPendingId: null, intakeLeaveRemovalPendingId: null,
    pilotBidderResetPending: false, biddingBackupBusy: false, liveDataWritesPending: 0,
  });
  vm.runInContext(['hasActiveIntakeEditing', 'hasActiveLiveDataEditing'].map(fn).join('\n'), range);
  assert.equal(range.hasActiveIntakeEditing(), true, `${interaction}: preserve draft panel`);
  assert.equal(range.hasActiveLiveDataEditing(), false, `${interaction}: allow incoming updates`);
}
console.log('PASS consecutive-range focused fields and unsaved draft notification guards');
