import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const html = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const builder = await readFile(new URL('../database/consistent_bid_window_builder.sql', import.meta.url), 'utf8')

assert.match(html, /data-bid-window-builder-consistent checked/)
assert.match(source, /settings\.keepAreasConsistent \? ZLA_AREAS : \[settings\.area\]/)
assert.match(source, /"generate_consistent_bid_window_schedules"/)
assert.match(source, /areaInput\.disabled = consistentInput\.checked/)
assert.match(source, /for \(let round = 1; round <= BID_WINDOW_BUILDER_ROUND_COUNT; round \+= 1\)/)
assert.match(source, /requested_round_count: BID_WINDOW_BUILDER_ROUND_COUNT/)
assert.match(builder, /create or replace function public\.generate_consistent_bid_window_schedules/)
assert.match(builder, /requested_round_count not between 1 and 6/)
assert.match(builder, /area_schedule_date := shared_round_start_date/)
assert.match(builder, /shared_round_start_date := round_last_scheduled_date \+ 1/)
assert.match(builder, /b\.bid_role not in \('ADM', 'NB'\)/)
assert.match(builder, /on conflict \(bid_year_id, bidder_id, round_number\) do update/)

console.log('Consistent all-area bid-window builder checks passed.')

// Exercise preview generation and the save RPC for both scheduling modes.
const rpcCalls = []
const settings = {
  area: 'Area B', keepAreasConsistent: false, startDate: '2026-10-01',
  opensAt: '07:00', closesAt: '09:00', windowMinutes: 120,
  reviewDays: 1, blackoutDates: ['2026-10-02'],
}
const context = vm.createContext({
  ZLA_AREAS: ['Area A', 'Area B'], BID_YEAR: 2027,
  AREA_CODE_BY_NAME: { 'Area A': 'A', 'Area B': 'B' },
  activeRosterEntries: (area) => Array.from({ length: area === 'Area A' ? 3 : 2 }, (_, i) => ({ area, rank: i + 1 })),
  rosterEntryToPerson: (entry) => entry,
  dateFromKey: (key) => new Date(`${key}T12:00:00Z`),
  dateKeyFromDate: (date) => date.toISOString().slice(0, 10),
  hasSystemAdminAccess: () => true,
  supabaseState: { connected: true },
  supabaseClient: () => ({ rpc: async (routine, parameters) => {
    rpcCalls.push({ routine, parameters })
    return { data: { windows_processed: 8 }, error: null }
  } }),
  loadSupabaseReferenceData: async () => {}, renderApp: () => {},
})
const builderSource = source.slice(source.indexOf('const BID_WINDOW_BUILDER_ROUND_COUNT'), source.indexOf('function renderAdminConsole()'))
vm.runInContext(builderSource + `
  let bidWindowBuilderPreview = null;
  let bidWindowBuilderSaving = false;
  let testSettings;
  let testStatus;
  bidWindowBuilderSettings = () => testSettings;
  renderBidWindowBuilderPreview = () => {};
  setBidWindowBuilderStatus = (message, status) => { testStatus = { message, status }; };
`, context)
for (const keepAreasConsistent of [false, true]) {
  context.settings = { ...settings, keepAreasConsistent }
  const preview = vm.runInContext('testSettings = settings; bidWindowBuilderPreview = generateBidWindowBuilderPreview(testSettings)', context)
  assert.deepEqual(Array.from(preview.areaSchedules, ({ area }) => area), keepAreasConsistent ? ['Area A', 'Area B'] : ['Area B'])
  for (const schedule of preview.areaSchedules) {
    for (const row of schedule.rows) {
      assert.deepEqual(Array.from(row.rounds, ({ round }) => round), [1, 2, 3, 4])
      assert.ok(row.rounds.every(({ date }) => !settings.blackoutDates.includes(date)))
    }
  }
  if (!keepAreasConsistent) {
    assert.equal(preview.areaSchedules[0].rows[1].rounds[0].date, '2026-10-03')
    assert.equal(preview.areaSchedules[0].rows[0].rounds[1].date, '2026-10-05')
  }
  await vm.runInContext('saveBidWindowBuilderSchedule()', context)
  const call = rpcCalls.at(-1)
  assert.equal(call.routine, keepAreasConsistent ? 'generate_consistent_bid_window_schedules' : 'generate_bid_window_schedule')
  assert.equal(call.parameters.requested_round_count, 4)
  assert.equal(call.parameters.requested_area_code, keepAreasConsistent ? undefined : 'B')
  assert.equal(vm.runInContext('testStatus.status', context), 'success')
}
assert.equal(rpcCalls.length, 2)
console.log('Four-round preview and single-area/all-area save regression checks passed.')
