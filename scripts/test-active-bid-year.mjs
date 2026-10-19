import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let href = 'https://example.test/bidding?tab=leave';
let navigation;
let requestedYears = [];
const context = vm.createContext({
  URL, console, Date,
  BID_YEAR: 2027, activeBidYear: null, bidYearCatalog: [], bidYearCatalogLoaded: false, bidYearCatalogError: "",
  window: { location: { get href() { return href; }, assign(value) { navigation = value; } },
    history: { state: {}, replaceState(_state, _title, value) { href = value; } } },
  dateKey: (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  syncBidYearControls() {},
  syncNavigationUrl(url) { href = url.href; },
  supabaseState: { connected: true },
  currentUser: { supabaseProfileId: 'bidder', initials: 'ME' },
  intakeQueue: [], rdoLineForInitials: () => null,
  datesInLeaveRange: () => ['2028-04-01'],
  attachLeaveRequestWeekBuckets: async (_client, rows) => rows,
  upsertLeaveRequestsFromDatabase() {},
});
for (const name of ['selectedBidYearErrorMessage', 'navigateToBidYear', 'loadBidYearCatalog', 'saveSupabaseRdoRequest', 'saveSupabaseLeaveRequests']) {
  vm.runInContext((['loadBidYearCatalog', 'saveSupabaseRdoRequest', 'saveSupabaseLeaveRequests'].includes(name) ? 'async ' : '') + extract(name), context);
}
let catalog = [ { bid_year: 2028, status: 'open', is_active: true }, { bid_year: 2027, status: 'open', is_active: false } ];
const client = { async rpc(name, params) {
  if (name === 'read_bid_year_catalog') return { data: catalog, error: null };
  if (name === 'read_leave_intake_queue') return { data: [], error: null };
  requestedYears.push(params.requested_bid_year);
  return { data: { submission_id: 'saved' }, error: null };
} };
context.supabaseClient = () => client;
assert.match(context.selectedBidYearErrorMessage(), /Checking/);
await context.loadBidYearCatalog(client);
assert.equal(context.BID_YEAR, 2028, 'A new visit uses the database active year');
assert.equal(context.BID_LEAVE_YEAR_START_KEY, '2028-01-10');
assert.equal(context.BID_LEAVE_YEAR_END_KEY, '2029-01-08');
assert.equal(context.FATIGUE_WEEK_ANCHOR_UTC, Date.UTC(2028, 0, 10));
assert.equal(context.selectedBidYearErrorMessage(), '');
assert.equal(new URL(href).searchParams.get('bidYear'), '2028');
await context.saveSupabaseRdoRequest({ line: '1', round: 1 });
await context.saveSupabaseLeaveRequests([{ range: 'Apr 1', round: 1 }], new Map());
assert.deepEqual(requestedYears, [2028, 2028], 'RDO and leave submissions explicitly use the selected year');
context.navigateToBidYear(2027);
assert.equal(new URL(navigation).searchParams.get('bidYear'), '2027');
assert.equal(new URL(navigation).searchParams.get('tab'), 'leave');
href = navigation;
await context.loadBidYearCatalog(client);
assert.equal(context.BID_YEAR, 2027);
assert.equal(context.activeBidYear, 2028, 'Viewing history does not change the active year');
assert.match(context.selectedBidYearErrorMessage(), /view-only/);
await assert.rejects(context.saveSupabaseRdoRequest({ line: '1', round: 1 }), /view-only/);
await assert.rejects(context.saveSupabaseLeaveRequests([{ range: 'Apr 1', round: 1 }], new Map()), /view-only/);
assert.deepEqual(requestedYears, [2028, 2028], 'Historical RDO and leave bids are blocked before reaching the API');
catalog = catalog.map((year) => ({ ...year, is_active: year.bid_year === 2027 }));
await context.loadBidYearCatalog(client);
assert.equal(context.BID_YEAR, 2027, 'Active-year changes never silently switch the selected view');
assert.equal(context.selectedBidYearErrorMessage(), '');
href = 'https://example.test/bidding?bidYear=2099';
await assert.rejects(context.loadBidYearCatalog(client), /not configured/);
context.window.NATCA_SUPABASE_CONFIG = { environment: 'pilot' };
href = 'https://example.test/bidding';
let pilotRpcCalls = 0;
await context.loadBidYearCatalog({ async rpc() { pilotRpcCalls++; return { data: catalog, error: null }; } });
assert.equal(pilotRpcCalls, 1, 'Pilot uses its own database catalog too');
assert.equal(context.activeBidYear, 2027);
let windowUpdates = 0;
context.withLeaveReadCache = (callback) => callback();
context.updateBidWindowWithCache = () => { windowUpdates++; };
context.isMemberAppVisible = () => true;
vm.runInContext(extract('updateBidWindow'), context);
context.currentUser = null;
context.updateBidWindow();
assert.equal(windowUpdates, 0, 'Expired sessions do not run member bidding timers');
context.currentUser = { area: 'Area A' };
context.isMemberAppVisible = () => false;
context.updateBidWindow();
assert.equal(windowUpdates, 0, 'Public views do not run member bidding timers');
context.isMemberAppVisible = () => true;
context.updateBidWindow();
assert.equal(windowUpdates, 1, 'Signed-in member bidding timers keep working');
console.log('PASS active-year defaults, selected-year isolation, date boundaries, explicit RDO year, archive blocking, and invalid-year rejection');

// A missing catalog RPC must not strand older single-year installations.
href = 'https://example.test/bidding';
const legacyClient = (rows) => ({
  async rpc() { return { error: { code: 'PGRST202', message: 'Missing catalog routine' } }; },
  from(table) {
    assert.equal(table, 'bid_years');
    return { select() { return { async limit() { return { data: rows, error: null }; } }; } };
  },
});
await context.loadBidYearCatalog(legacyClient([{ bid_year: 2027, status: 'open' }]));
assert.equal(context.selectedBidYearErrorMessage(), '');
await assert.rejects(context.loadBidYearCatalog(legacyClient([
  { bid_year: 2027, status: 'open' }, { bid_year: 2028, status: 'open' },
])), /must be configured/);
assert.match(context.selectedBidYearErrorMessage(), /could not be verified/);
assert.equal(context.bidYearCatalogLoaded, false);
await assert.rejects(context.saveSupabaseRdoRequest({ line: '1', round: 1 }), /could not be verified/);
await context.loadBidYearCatalog(client);
assert.equal(context.selectedBidYearErrorMessage(), '', 'Successful retry clears the error');
console.log('PASS missing catalog compatibility, ambiguous-year blocking, and recovery');
