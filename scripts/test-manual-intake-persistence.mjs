import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')

assert.match(source, /async function submitManualRdoBid\(/)
assert.match(source, /selectManualLeaveController\(person\.initials\);[\s\S]*renderApp\(\)/)
assert.match(source, /controller: panel\.querySelector\("\[data-manual-bid-controller\]"\)\?\.value \|\| \(leavePanel && manualLeaveControllerInitials\)/)
assert.match(source, /async function submitManualLeaveBid\(/)
assert.match(source, /saveSupabaseManualRdoRequest\(request, person, area\)/)
assert.match(source, /saveSupabaseManualLeaveRequest\(requests, person, area\)/)
assert.match(source, /const entries = manualLeaveBatch\.entries\.length/)
assert.match(source, /prepareManualLeaveEntries\(panel, person, area, entries\)/)
assert.match(source, /new Set\(rawDateKeys\)\.size !== rawDateKeys\.length/)
assert.match(source, /requested_items: requestedItems/)
assert.match(source, /target_initials: person\.initials,[\s\S]*target_area_name: area,[\s\S]*manual_entry: true/)
assert.match(source, /request\.supabaseSubmissionId = savedSubmission\.submission_id/)
assert.match(source, /item\.supabaseSubmissionId = savedBatch\.submission_ids\[index\]/)
assert.match(source, /if \(panel\) await submitManualBidEntry\(panel\)/)
assert.match(source, /panel\.dataset\.manualBidSubmitting === "true"/)
assert.match(source, /Supabase did not return the saved manual RDO submission/)
assert.match(source, /Supabase did not return the saved manual leave submission/)
const manualRdoSave = source.match(/async function saveSupabaseManualRdoRequest\(request, person, area\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(manualRdoSave, 'Manual RDO submissions must use the database RPC')
const submitted = []
const selectLeaveController = source.match(/function selectManualLeaveController\(initials\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(selectLeaveController, 'RDO submission should preselect the same controller for leave')
const leaveController = { value: '' }
const leaveSearch = { value: 'previous search' }
let leaveRenders = 0
const leavePanel = { querySelector: (selector) => selector === '[data-manual-bid-controller]' ? leaveController : leaveSearch }
const handoffContext = vm.createContext({
  document: { querySelector: () => leavePanel },
  renderManualBidPanel: () => { leaveRenders += 1 },
})
vm.runInContext(`let manualLeaveControllerInitials = ''; ${selectLeaveController}; selectManualLeaveController('TB')`, handoffContext)
assert.equal(leaveController.value, 'TB')
assert.equal(leaveSearch.value, '')
assert.equal(leaveRenders, 1)
assert.equal(vm.runInContext('manualLeaveControllerInitials', handoffContext), 'TB')
const saveManualRdo = vm.runInNewContext(`${manualRdoSave}; saveSupabaseManualRdoRequest`, {
  supabaseClient: () => ({
    rpc: async (_name, payload) => {
      submitted.push(payload)
      return { data: { submission_id: 'saved' }, error: null }
    },
  }),
  currentUser: { supabaseProfileId: 'reviewer' },
  BID_YEAR: 2027,
  selectedBidYearErrorMessage: () => '',
  Error,
})
const manualRequest = { line: '4', fatigueGroup: '', flex: 'Yes', aws: 'Yes', mid: 'No', round: 1 }
await saveManualRdo(manualRequest, { initials: 'VO' }, 'Area A')
assert.equal(submitted.at(-1).requested_fatigue_group, null, 'No preference must reach Supabase as null')
await saveManualRdo({ ...manualRequest, fatigueGroup: 'B' }, { initials: 'VO' }, 'Area A')
assert.equal(submitted.at(-1).requested_fatigue_group, 'B', 'A selected fatigue group must be preserved')
assert.match(source, /const requestedDates = leaveSlotDateKeys\(dateKeys, person\.initials\)/)
assert.match(source, /start_date: request\.startDateKey,[\s\S]*end_date: request\.endDateKey/)

const defaultEndDate = source.match(/function defaultManualLeaveEndDate\(panel\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(defaultEndDate, 'Intake leave should default the end date from the start date')
const dateContext = vm.createContext({})
vm.runInContext(defaultEndDate, dateContext)
const startInput = { value: '2027-01-11' }
const endInput = { value: '2027-01-15' }
const panel = { querySelector: (selector) => selector === '[data-manual-leave-start]' ? startInput : endInput }
dateContext.defaultManualLeaveEndDate(panel)
assert.equal(endInput.value, startInput.value)
startInput.value = '2027-01-12'
dateContext.defaultManualLeaveEndDate(panel)
assert.equal(endInput.value, '2027-01-12')
startInput.value = ''
dateContext.defaultManualLeaveEndDate(panel)
assert.equal(endInput.value, '2027-01-12')
assert.match(source, /manualLeaveDateField\.matches\("\[data-manual-leave-start\]"\)\) defaultManualLeaveEndDate\(manualPanel\)/)
assert.match(source, /manualReactiveField\.matches\("\[data-manual-leave-start\]"\)\) defaultManualLeaveEndDate\(manualPanel\)/)

const helper = source.match(/function contiguousLeaveDateRanges\(keys\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(helper, 'Manual leave must group non-RDO dates into contiguous requests')
const context = vm.createContext({
  addDaysToDateKey(key, days) {
    const date = new Date(`${key}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  },
})
vm.runInContext(helper, context)
const grouped = vm.runInContext(`contiguousLeaveDateRanges([
  '2027-01-20', '2027-01-21', '2027-01-23', '2027-01-24'
])`, context)
assert.deepEqual(JSON.parse(JSON.stringify(grouped)), [
  ['2027-01-20', '2027-01-21'],
  ['2027-01-23', '2027-01-24'],
])

const validationSource = source.match(/function manualLeaveValidationMessage\([^]*?\n\}/)?.[0]
const prepareSource = source.match(/function prepareManualLeaveEntries\([^]*?\n\}/)?.[0]
assert.ok(validationSource && prepareSource, 'Batch validation must remain available')
const batchContext = vm.createContext({
  BID_YEAR: 2027,
  currentUser: { initials: 'IN' },
  openAreaBidRound: () => batchContext.activeRound,
  datesInLeaveRange: (range) => range.split(','),
  invalidLeaveYearDateKeys: () => [],
  leaveSlotDateKeys: (keys) => keys,
  chargeableLeaveDatesForInitials: (range) => range.split(','),
  contiguousLeaveDateRanges: (keys) => keys.map((key) => [key]),
  roundOneWeekKeysForDateKeys: (keys) => [...new Set(keys.map((key) => key.slice(-2)))],
  roundOneWeekKeySetForItems: (items) => new Set(items.flatMap((item) => item.dateKeys || [])),
  roundOneWeekLimit: () => 2,
  leaveRoundUsageForInitials: () => [],
  leaveDayLimitForRound: () => 3,
  leaveItemChargedDays: () => 0,
  leaveAreaCapacityMessage: () => '',
  formatDateTime: () => 'now',
  controllerName: () => 'Test Bidder',
  formatLeaveRangeFromKeys: (keys) => keys.join(','),
  chargeableLeaveDateKeys: (keys) => keys,
})
const submissionRoleSource = source.match(/function submissionRoleLabel\([^]*?\n\}/)?.[0]
assert.ok(submissionRoleSource)
vm.runInContext(`${submissionRoleSource}\n${validationSource}\n${prepareSource}`, batchContext)
const batchPanel = { querySelector: () => ({ value: String(batchContext.activeRound) }) }
const batchPerson = { initials: 'TB', bidAs: 'CPC', rank: 1 }
batchContext.activeRound = 2
const validBatch = batchContext.prepareManualLeaveEntries(batchPanel, batchPerson, 'Area A', [
  { range: '2027-01-11', notes: 'first' },
  { range: '2027-01-12', notes: 'second' },
])
assert.equal(validBatch.requests.length, 2)
assert.deepEqual(validBatch.requests.map((item) => item.notes), ['first', 'second'])
assert.throws(() => batchContext.prepareManualLeaveEntries(batchPanel, batchPerson, 'Area A', [
  { range: '2027-01-11' }, { range: '2027-01-11' },
]), /overlap/)
assert.throws(() => batchContext.prepareManualLeaveEntries(batchPanel, batchPerson, 'Area A', [
  { range: '2027-01-11,2027-01-12' }, { range: '2027-01-13,2027-01-14' },
]), /up to 3 charged days/)
batchContext.activeRound = 1
assert.throws(() => batchContext.prepareManualLeaveEntries(batchPanel, batchPerson, 'Area A', [
  { range: '2027-01-11' }, { range: '2027-01-12' }, { range: '2027-01-13' },
]), /up to 2 bid weeks/)

console.log('Manual intake persistence regression checks passed.')

// A manual save must render the authoritative charges and grouping immediately.
const submitManualLeave = source.match(/async function submitManualLeaveBid\(panel, person, area\) \{[\s\S]*?\n\}/)?.[0]
const saveEvents = []
const savedLeaveContext = vm.createContext({
  manualLeaveBatch: { key: '', entries: [] },
  manualLeaveBatchKey: () => 'bidder-round-one',
  manualLeaveRangeValue: () => 'June 7–11',
  prepareManualLeaveEntries: () => ({ request: { range: 'June 7–11' }, requests: [{ days: 5 }] }),
  setManualBidStatus: () => {},
  saveSupabaseManualLeaveRequest: async () => { saveEvents.push('save'); return { submission_ids: ['saved'] } },
  refreshBiddingAfterIntakeDecision: async () => {
    saveEvents.push('refresh');
    savedLeaveContext.intakeQueue = [{ days: 3, submissionBatchKey: 'saved-batch' }];
  },
  intakeQueue: [],
  currentUser: { initials: 'ADMIN' },
  logHistory: () => {}, queueBidSubmittedEmail: () => {},
  renderApp: () => {
    saveEvents.push('render');
    assert.equal(savedLeaveContext.intakeQueue[0].days, 3);
    assert.equal(savedLeaveContext.intakeQueue[0].submissionBatchKey, 'saved-batch');
    assert.equal(savedLeaveContext.intakeQueue.length, 1);
  },
});
vm.runInContext(submitManualLeave, savedLeaveContext);
await savedLeaveContext.submitManualLeaveBid({ querySelector: () => ({ value: '1' }) }, { initials: 'ME' }, 'Area A');
assert.deepEqual(saveEvents, ['save', 'refresh', 'render']);
console.log('PASS manual leave save reloads approved-RDO charges and batch metadata before rendering');
