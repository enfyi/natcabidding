import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('../database/bid_time_import.sql', import.meta.url), 'utf8')
const pilotProfileSql = await readFile(new URL('../database/pilot_auth_profile.sql', import.meta.url), 'utf8')
const rlsSql = await readFile(new URL('../database/rls_area_policies.sql', import.meta.url), 'utf8')
const adminVisibilityMigration = await readFile(
  new URL('../supabase/migrations/20260926170317_allow_admin_read_all_bid_windows.sql', import.meta.url),
  'utf8',
)

assert.match(
  sql,
  /row_number\(\) over \(\s*partition by b\.area_id\s*order by b\.seniority_rank nulls last, b\.last_name, b\.first_name, b\.id\s*\)::integer as area_seniority_rank/s,
  'bid-time imports must calculate the same area-relative rank as the bidding roster',
)
assert.match(
  sql,
  /b\.bid_role not in \('ADM', 'NB'\)/,
  'administrative and non-bidding profiles must not shift an imported bidder rank',
)
assert.match(
  sql,
  /ranked\.area_seniority_rank = requested_rank/,
  'the spreadsheet rank must match the displayed area-relative rank',
)
assert.doesNotMatch(
  sql,
  /b\.seniority_rank = requested_rank/,
  'the spreadsheet rank must not match the raw stored rank',
)
assert.match(
  pilotProfileSql,
  /where area_bidders\.active\s+and area_bidders\.bid_role not in \('ADM', 'NB'\)/s,
  'the pilot login profile must use the same participating roster as bid-time imports',
)
for (const policySql of [rlsSql, adminVisibilityMigration]) {
  assert.match(
    policySql,
    /\(select public\.is_current_admin\(\)\)\s+or public\.is_bidder_in_current_area\(bidder_id\)/s,
    'system admins must be able to read imported bid windows across every area',
  )
  assert.match(
    policySql,
    /on (?:public\.)?bid_windows for select\s+to authenticated/s,
    'cross-area visibility must remain limited to authenticated bid-window reads',
  )
}

console.log('Bid-time import ranking regression checks passed.')
