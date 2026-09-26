import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('../database/bid_time_import.sql', import.meta.url), 'utf8')
const pilotProfileSql = await readFile(new URL('../database/pilot_auth_profile.sql', import.meta.url), 'utf8')

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

console.log('Bid-time import ranking regression checks passed.')
