import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [clientSource, pilotModeSql, migrationSql, pilotSeedSql] = await Promise.all([
  readFile(new URL('../bidding.js', import.meta.url), 'utf8'),
  readFile(new URL('../database/pilot_mode.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260928090000_pilot_bidders_bypass_bid_windows.sql', import.meta.url), 'utf8'),
  readFile(new URL('../database/pilot_seed.sql', import.meta.url), 'utf8'),
])

assert.match(
  clientSource,
  /function isAuthorizedPilotBidder\(\) \{\s*return pilotState\.database && pilotState\.enabled && pilotState\.allowed;\s*\}/,
  'The browser must recognize only enabled, authorized pilot bidders',
)
assert.match(
  clientSource,
  /function bidWindowLockIsBypassed\(\) \{\s*if \(pilotState\.database\) return isAuthorizedPilotBidder\(\);/,
  'Authorized pilot bidders must bypass the browser bid-window lock',
)

for (const [label, sql] of [
  ['pilot installer', pilotModeSql],
  ['pilot migration', migrationSql],
]) {
  assert.match(sql, /new\.enforce_bid_windows := false;/, `${label} must force pilot bid-window enforcement off`)
  assert.match(
    sql,
    /before insert or update on public\.bid_year_settings[\s\S]*disable_pilot_bid_window_enforcement\(\)/,
    `${label} must protect pilot settings from re-enabling the restriction`,
  )
}

assert.match(
  pilotSeedSql,
  /set pilot_database = true,\s*enforce_bid_windows = false,/,
  'Pilot setup must start with bid-window enforcement disabled',
)

console.log('PASS pilot participants bypass bid windows while the pilot allowlist remains authoritative')
