import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')
const migration = await readFile(
  new URL('../supabase/migrations/20260928030000_expire_round_one_leave_on_rdo_change.sql', import.meta.url),
  'utf8',
)

assert.match(source, /function pendingCurrentUserLeaveRequests\(/)
assert.match(source, /Wait until they are approved or denied before changing your RDO bid/)
assert.match(source, /Are you sure you want to change your RDO bid\? All approved Round 1 leave dates will expire/)
assert.match(source, /item\.status === "Pending"[\s\S]{0,240}Wait until they are approved or denied before changing them/)
assert.match(source, /item\.status !== "Approved"[\s\S]{0,240}awaiting an intake decision/)
assert.match(source, /expired: "Expired"/)
assert.match(html, /<option value="Expired">Expired<\/option>/)

assert.match(migration, /status in \('draft', 'preview', 'pending', 'approved', 'denied', 'cancelled', 'expired'\)/)
assert.match(migration, /create or replace function public\.expire_round_one_leave_after_rdo_change\(\)/)
assert.match(migration, /request\.round_number = 1[\s\S]{0,120}request\.status = 'pending'/)
assert.match(migration, /raise exception 'Your Round 1 leave dates are awaiting an intake decision/)
assert.match(migration, /set status = 'expired'/)
assert.match(migration, /source_leave_request_id = null/)
assert.match(migration, /'round_one_leave_expired_after_rdo_change'/)
assert.match(migration, /create or replace function public\.enforce_pending_leave_bidder_lock\(\)/)
assert.match(migration, /old\.status <> 'pending'/)
assert.match(migration, /actor_role not in \('admin', 'intake'\)/)

console.log('PASS approved RDO changes expire approved Round 1 leave while pending decisions remain locked')
