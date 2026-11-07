import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../public/bidding-exports.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
function setup(overrides = {}) {
  const requests = [];
  const context = vm.createContext({
    URL, Map, Set, Promise, Date, console,
    BID_YEAR: 2027, publicAreaDataDeferred: true,
    publicInfoDataPromise: null, publicAreaDataPromise: null,
    referenceDataPromise: null, referenceDataPromiseIdentity: '',
    referenceDataFreshness: new Map(), liveDataLastReadAt: new Map(),
    supabaseState: { authUserId: '', connected: false, loading: false },
    publicState: { area: 'FAQ' }, ZLA_AREAS: ['Area A'],
    publicFaqContent: { entries: [], documents: [] },
    window: { NATCA_SUPABASE_CONFIG: {} },
    alertRealtimeUserId: 'public',
    isMemberAppVisible: () => false,
    refreshPublicReferenceSection() {}, renderPublicPage() {},
    loadBidYearCatalog: async () => { requests.push('catalog'); },
    readReferenceData: async (label, request) => { requests.push(label); return request(); },
    supabaseClient: () => ({ from: name => {
      assert.ok(['faq_entries', 'mou_documents'].includes(name), `Unexpected startup table ${name}`);
      const query = { select: () => query, eq: () => query, order: () => query,
        then: resolve => Promise.resolve({ data: [{ table: name }], error: null }).then(resolve) };
      return query;
    } }),
    ...overrides,
  });
  for (const name of ['rememberReferenceDataRead', 'loadPublicInformation', 'ensurePublicAreaData',
    'loadPublicStartupData', 'loadSupabaseReferenceData']) vm.runInContext(extract(name), context);
  return { context, requests };
}
{
  let finishCatalog;
  const { context } = setup({ loadBidYearCatalog: () => new Promise(resolve => { finishCatalog = resolve; }) });
  const pending = context.loadPublicStartupData();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(context.supabaseState.faqLoadState, 'loaded', 'Slow year metadata must not block FAQ rendering');
  finishCatalog();
  await pending;
}
{
  let reads = 0;
  const { context, requests } = setup({ loadSupabaseReferenceDataNow: async () => { reads++; } });
  await Promise.all([context.loadPublicStartupData(), context.loadPublicStartupData()]);
  assert.deepEqual(requests, ['catalog', 'FAQ entries', 'MOU documents']);
  assert.equal(reads, 0, 'No roster, windows, slots, or RDO reads on FAQ');
  assert.equal(context.publicFaqContent.entries[0].table, 'faq_entries');
  assert.ok(context.liveDataLastReadAt.has('faq'));
  context.loadSupabaseReferenceDataNow = async () => { reads++; context.supabaseState.connected = true; };
  context.publicState.area = 'Area A';
  await Promise.all([context.ensurePublicAreaData(), context.ensurePublicAreaData()]);
  assert.equal(reads, 1, 'Concurrent area navigations share their read');
  await context.ensurePublicAreaData();
  assert.equal(reads, 1, 'Revisiting areas reuses loaded data');
}
{
  let reads = 0;
  const { context } = setup({ loadSupabaseReferenceDataNow: async () => { reads++; } });
  await context.ensurePublicAreaData();
  assert.equal(context.publicAreaDataDeferred, true);
  await context.ensurePublicAreaData();
  assert.equal(reads, 2, 'Failed area read can be retried');
}
{
  let finish;
  const calls = [];
  const { context } = setup({ loadSupabaseReferenceDataNow: () => {
    calls.push(context.supabaseState.authUserId || 'public');
    return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
  } });
  const publicLoad = context.loadSupabaseReferenceData();
  context.supabaseState.authUserId = 'member';
  const memberLoad = context.loadSupabaseReferenceData();
  assert.deepEqual(calls, ['public']);
  finish();
  await Promise.all([publicLoad, memberLoad]);
  assert.deepEqual(calls, ['public', 'member'], 'Member startup gets its own data after public startup');
}
{
  const scheduled = [];
  const channel = { on: () => channel, subscribe: fn => { context.subscription = fn; } };
  const { context } = setup({
    supabaseClient: () => ({ channel: () => channel }),
    alertRealtimeUserId: '', liveDataTables: { faq: ['faq_entries'], slots: ['leave_slots'] },
    stopLiveAlertUpdates: () => context.liveDataLastReadAt.clear(),
    scheduleLiveDataRefresh: groups => scheduled.push(groups),
  });
  vm.runInContext(extract('liveDataFallbackGroups') + extract('startLiveAlertUpdates'), context);
  context.referenceDataFreshness.set('faq', { identity: '[2027,"public"]', startedAt: Date.now() });
  context.referenceDataFreshness.set('slots', { identity: '[2027,"public"]', startedAt: Date.now() });
  context.startLiveAlertUpdates();
  context.subscription('SUBSCRIBED');
  assert.equal(scheduled[0].length, 0, 'Fresh startup reads are not repeated on subscription');
  context.liveDataLastReadAt.set('slots', Date.now() - 61000);
  context.subscription('SUBSCRIBED');
  assert.deepEqual(Array.from(scheduled[1]), ['slots'], 'Reconnect repairs stale data');
  context.liveDataLastReadAt.clear();
  context.referenceDataFreshness.set('faq', { identity: '[2027,"other-member"]', startedAt: Date.now() });
  context.alertRealtimeUserId = '';
  context.startLiveAlertUpdates();
  assert.equal(context.liveDataLastReadAt.has('faq'), false, 'Never reuse freshness from another user');
}
{
  const callbacks = [];
  const { context } = setup({
    liveDataDirtyGroups: new Set(), liveDataTimer: null,
    clearTimeout() {}, setTimeout: fn => { callbacks.push(fn); return 1; },
    refreshLiveData() {},
  });
  vm.runInContext(extract('scheduleLiveDataRefresh'), context);
  context.scheduleLiveDataRefresh(['faq', 'roster', 'slots', 'help', 'schedules']);
  assert.deepEqual(Array.from(context.liveDataDirtyGroups), ['faq']);
  context.liveDataDirtyGroups.clear();
  context.publicAreaDataDeferred = false;
  context.scheduleLiveDataRefresh(['roster', 'slots']);
  assert.deepEqual(Array.from(context.liveDataDirtyGroups), ['roster', 'slots'], 'Live bidding updates still refresh after opening an area');
  context.liveDataDirtyGroups.clear();
  context.publicAreaDataDeferred = true;
  context.window.NATCA_SUPABASE_CONFIG.environment = 'pilot';
  context.scheduleLiveDataRefresh(['faq', 'roster', 'slots']);
  assert.deepEqual(Array.from(context.liveDataDirtyGroups), ['slots'], 'Signed-out pilot keeps its calendar refresh');
}
{
  let script;
  let appends = 0;
  const context = vm.createContext({
    URL, Promise, window: { location: { href: 'https://example.test/bidding/bidding.html' } },
    setTimeout: () => 1, clearTimeout() {},
    document: { createElement: () => (script = { remove() {} }), head: { appendChild() { appends++; } } },
  });
  vm.runInContext('let biddingExportsPromise = null;\n' + extract('loadBiddingExports'), context);
  const first = context.loadBiddingExports();
  const second = context.loadBiddingExports();
  assert.equal(first, second);
  assert.equal(appends, 1, 'One script for simultaneous exports');
  assert.equal(new URL(script.src).pathname, '/bidding/bidding-exports.js', 'Preserve self-hosted base path');
  script.onerror();
  await assert.rejects(first, /Export tools could not load/);
  const retry = context.loadBiddingExports();
  assert.equal(appends, 2, 'Retry a failed script download');
  vm.runInContext(exportSource, context);
  script.onload();
  const tools = await retry;
  assert.deepEqual(Object.keys(tools).sort(), ['downloadBiddingCsv', 'downloadBiddingXlsx', 'downloadValidationXlsx', 'exportBidTimes', 'exportSeniorityRoster']);
  assert.equal(await context.loadBiddingExports(), tools, 'Reuse the loaded tools');
  assert.equal(appends, 2);
}
console.log('PASS FAQ-only startup, area loading/retries, sign-in race, fresh subscriptions, live invalidation, and export loading/retries/base paths.');
