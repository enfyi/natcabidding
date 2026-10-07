import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, migration] = await Promise.all([
  readFile(new URL('../bidding.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261005191311_round_up_earned_leave_days.sql', import.meta.url), 'utf8'),
])

for (const [hours, hoursPerDay, expectedDays] of [
  [208, 10, 21],
  [208, 8, 26],
  [200, 10, 20],
  [201, 8, 26],
]) {
  assert.equal(Math.ceil(hours / hoursPerDay), expectedDays)
}

assert.match(source, /function currentUserBaseLeaveAllowanceDays\(\) \{\s*return Math\.ceil\(estimatedLeaveDaysFromHours/)
assert.match(source, /formatRoundedUpLeaveDays\(allowanceDays\) \+ " days/)
assert.match(source, /currentUserBaseLeaveAllowanceDays\(\) \* leaveHoursPerDayForInitials\(\)/)
assert.match(migration, /create or replace function private\.rounded_leave_allowance_hours\(/)
assert.match(migration, /target\.leave_slot_allowance, leave_hours_per_day/)
assert.match(migration, /target\.leave_slot_allowance, day_hours/)
assert.match(migration, /private\.round_four_allowances/)

console.log('Rounded earned-leave regression checks passed.')
