import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(
  new URL('../supabase/migrations/20261001131513_track_rdo_bid_changes.sql', import.meta.url),
  'utf8',
)
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../bidding.css', import.meta.url), 'utf8')

assert.match(migration, /add column if not exists is_change boolean not null default false/)
assert.match(migration, /add column if not exists supersedes_submission_id uuid/)
assert.match(migration, /add column if not exists original_bid jsonb/)
assert.match(migration, /create trigger classify_rdo_bid_change/)
assert.match(migration, /submission\.status = 'approved'/)
assert.match(migration, /material_pending_edit/)
assert.match(migration, /if tg_op = 'UPDATE' and old\.is_change then[\s\S]*new\.original_bid := old\.original_bid/)
assert.match(migration, /'isChange', s\.is_change/)
assert.match(migration, /'originalBid', s\.original_bid/)
assert.match(migration, /'changeEnteredBy', change_actor\.initials/)

assert.match(source, /function rdoBidValuesChanged\(/)
assert.match(source, /Confirm RDO bid change for \$\{name\} · \$\{person\.initials\} · \$\{person\.area\}/)
assert.match(source, /request\.changeSource = "bidder"/)
assert.match(source, /request\.changeSource = "intake"/)
assert.match(source, /bidderId: row\.bidderId \|\| row\.bidder_id/)
assert.match(source, /class="intake-change-badge">Change/)
assert.match(source, /<b>Original:<\/b>/)
assert.match(source, /<b>Requested:<\/b>/)
assert.match(source, /person\.area} · \$\{person\.bidAs/)
assert.match(css, /\.intake-change-history/)
assert.match(css, /\.intake-change-badge/)

console.log('PASS RDO replacements and pending edits retain their original bid and are labeled as changes in intake')
