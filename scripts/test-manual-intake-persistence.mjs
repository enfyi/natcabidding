import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')

assert.match(source, /async function submitManualRdoBid\(/)
assert.match(source, /async function submitManualLeaveBid\(/)
assert.match(source, /saveSupabaseManualRdoRequest\(request, person, area\)/)
assert.match(source, /saveSupabaseManualLeaveRequest\(request, person, area, notes\)/)
assert.match(source, /target_initials: person\.initials,[\s\S]*target_area_name: area,[\s\S]*manual_entry: true/)
assert.match(source, /request\.supabaseSubmissionId = savedSubmission\.submission_id/)
assert.match(source, /request\.supabaseSubmissionId = submissionId/)
assert.match(source, /if \(panel\) await submitManualBidEntry\(panel\)/)
assert.match(source, /panel\.dataset\.manualBidSubmitting === "true"/)
assert.match(source, /Supabase did not return the saved manual RDO submission/)
assert.match(source, /Supabase did not return the saved manual leave submission/)
const manualRdoSave = source.match(/async function saveSupabaseManualRdoRequest\(request, person, area\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(manualRdoSave, 'Manual RDO submissions must use the database RPC')
const submitted = []
const saveManualRdo = vm.runInNewContext(`${manualRdoSave}; saveSupabaseManualRdoRequest`, {
  supabaseClient: () => ({
    rpc: async (_name, payload) => {
      submitted.push(payload)
      return { data: { submission_id: 'saved' }, error: null }
    },
  }),
  currentUser: { supabaseProfileId: 'reviewer' },
  BID_YEAR: 2027,
  Error,
})
const manualRequest = { line: '4', fatigueGroup: '', flex: 'Yes', aws: 'Yes', mid: 'No', round: 1 }
await saveManualRdo(manualRequest, { initials: 'VO' }, 'Area A')
assert.equal(submitted.at(-1).requested_fatigue_group, null, 'No preference must reach Supabase as null')
await saveManualRdo({ ...manualRequest, fatigueGroup: 'B' }, { initials: 'VO' }, 'Area A')
assert.equal(submitted.at(-1).requested_fatigue_group, 'B', 'A selected fatigue group must be preserved')

console.log('Manual intake persistence regression checks passed.')
