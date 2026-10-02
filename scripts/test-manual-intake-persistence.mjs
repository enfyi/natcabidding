import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')

assert.match(source, /async function submitManualRdoBid\(/)
assert.match(source, /async function submitManualLeaveBid\(/)
assert.match(source, /saveSupabaseManualRdoRequest\(request, person, area\)/)
assert.match(source, /saveSupabaseManualLeaveRequest\(requests, person, area, notes\)/)
assert.match(source, /target_initials: person\.initials,[\s\S]*target_area_name: area,[\s\S]*manual_entry: true/)
assert.match(source, /request\.supabaseSubmissionId = savedSubmission\.submission_id/)
assert.match(source, /item\.supabaseSubmissionId = savedBatch\.submission_ids\[index\]/)
assert.match(source, /if \(panel\) await submitManualBidEntry\(panel\)/)
assert.match(source, /panel\.dataset\.manualBidSubmitting === "true"/)
assert.match(source, /Supabase did not return the saved manual RDO submission/)
assert.match(source, /Supabase did not return the saved manual leave submission/)
assert.match(source, /const requestedDates = leaveSlotDateKeys\(dateKeys, person\.initials\)/)
assert.match(source, /start_date: request\.startDateKey,[\s\S]*end_date: request\.endDateKey/)

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

console.log('Manual intake persistence regression checks passed.')
