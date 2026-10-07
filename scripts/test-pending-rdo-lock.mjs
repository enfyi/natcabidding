import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const migration = await readFile(
  new URL('../supabase/migrations/20260926193000_lock_pending_rdo_bidder_changes.sql', import.meta.url),
  'utf8',
)

assert.match(source, /function pendingCurrentUserRdoRequest\(/)
assert.match(source, /Your RDO bid is awaiting an intake decision/)
assert.match(source, /button\.textContent = "Awaiting Intaker Decision"/)
assert.match(source, /const bidderSelectionLocked = Boolean\(pendingRequest\)/)
assert.match(source, /isViewingHomeArea\(\) && !bidderSelectionLocked/)
assert.match(source, /const submittedLine = submittedRdoLineForInitials\(currentUser\.initials\)/)
assert.match(source, /const isRdo = isRdoDateForInitials\(key, currentUser\.initials\)/)
assert.match(source, /RDO on your submitted line; leave bidding unavailable/)
assert.match(source, /data-calendar-date="\$\{key\}"/)
assert.match(source, /querySelectorAll\("\.app-shell \[data-calendar-date\]"\)/)
assert.match(source, /const isPreviewLeave = [\s\S]*context\.previewDates\.has\(key\)/)

assert.match(migration, /create or replace function public\.enforce_pending_rdo_bidder_lock\(\)/)
assert.match(migration, /actor_role in \('admin', 'intake'\)/)
assert.match(migration, /tg_op = 'UPDATE'[\s\S]*old\.status = 'pending'/)
assert.match(migration, /tg_op = 'INSERT'[\s\S]*submission\.status = 'pending'/)
assert.match(migration, /revoke all on function public\.enforce_pending_rdo_bidder_lock\(\) from public, anon, authenticated/)

console.log('Pending RDO bidder lock regression checks passed.')
