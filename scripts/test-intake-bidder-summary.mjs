import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, html, css, migration] = await Promise.all([
  readFile(new URL('../bidding.js', import.meta.url), 'utf8'),
  readFile(new URL('../bidding.html', import.meta.url), 'utf8'),
  readFile(new URL('../bidding.css', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260930101500_intake_bidder_summary.sql', import.meta.url), 'utf8'),
])

assert.match(html, /data-intake-bidder-overview/)
assert.match(html, /data-intake-bidder-summary/)
assert.match(source, /function selectIntakeBidder\(/)
assert.match(source, /selectIntakeBidder\(person\.initials, person\.profileId\)/)
assert.match(source, /selectIntakeBidder\(item\.initials, item\.bidderId\)/)
assert.match(source, /data-intake-bidder-detail-open="contact"/)
assert.match(source, /data-intake-bidder-detail-open="bids"/)
assert.match(source, /client\.rpc\("read_admin_bidder_editor"/)
assert.match(source, /formatRoundedUpLeaveDays\(allowanceDays\) \+ " days/)
assert.match(source, /Math\.ceil\(estimatedLeaveDaysFromHours\(currentUserLeaveAllowanceHours\(\), leaveHoursPerDayForInitials\(\)\)\)/)
assert.match(source, /const holidaysBid = new Set/)
assert.match(css, /\.intake-bidder-summary/)
assert.match(migration, /'email',b\.email/)
assert.match(migration, /'phone',b\.phone/)
assert.match(migration, /'leave_slot_allowance',b\.leave_slot_allowance/)
assert.match(migration, /from public\.leave_request_dates day/)
assert.match(migration, /'is_holiday_in_lieu', day\.is_holiday_in_lieu/)
assert.match(migration, /private\.bidder_editor_actor\(target_bidder_id\)/)
assert.match(migration, /grant execute on function public\.read_admin_bidder_editor/)

console.log('Selected intake bidder summary regression checks passed.')
