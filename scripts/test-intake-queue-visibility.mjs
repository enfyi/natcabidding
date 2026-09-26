import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const migration = await readFile(
  new URL('../supabase/migrations/20260926182500_fix_cross_area_intake_queue.sql', import.meta.url),
  'utf8',
)

assert.match(source, /client\.rpc\("read_bidding_state", \{ requested_bid_year: BID_YEAR \}\)/)
assert.match(source, /function intakeSubmissionIdFromBiddingState\(/)
assert.match(source, /submission_id: intakeSubmissionIdFromBiddingState\(item, submissions\)/)
assert.match(source, /supabaseSubmissionId: row\.submission_id \|\| ""/)
assert.match(source, /payload\.start_date \|\| payload\.startDate/)
assert.match(source, /payload\.end_date \|\| payload\.endDate/)
assert.doesNotMatch(
  source,
  /\.from\("intake_submissions"\)[\s\S]{0,200}\.eq\("leave_request_id"/,
  'Intake review must not recover submission IDs through own-area table RLS',
)

assert.match(migration, /'requestId', s\.leave_request_id/)
assert.match(migration, /actor\.role in \('admin', 'intake'\)/)

console.log('Cross-area intake queue regression checks passed.')
