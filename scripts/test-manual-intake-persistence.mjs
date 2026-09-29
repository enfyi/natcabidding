import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

console.log('Manual intake persistence regression checks passed.')
