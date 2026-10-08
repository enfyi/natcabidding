import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const markup = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migrations/20261003000521_intake_access_one_hour.sql', import.meta.url), 'utf8')
const now = new Date('2027-03-01T12:00:00Z')
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [now.getTime()]))
  }
}
const context = vm.createContext({
  currentUser: { initials: 'OC' },
  intakeSchedules: [],
  Date: FixedDate,
})

const helper = source.match(/function activeScheduledIntakeWindow\(\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(helper, 'Scheduled Intake access helper must exist')
vm.runInContext(helper, context)
context.intakeSchedules = [{
  initials: 'OC',
  start: new Date(now.getTime() + 60 * 60 * 1000),
  end: new Date(now.getTime() + 3 * 60 * 60 * 1000),
}]
assert.ok(context.activeScheduledIntakeWindow(), 'Access starts one hour before the shift')
context.intakeSchedules[0].start = new Date(now.getTime() + 60 * 60 * 1000 + 1000)
assert.equal(context.activeScheduledIntakeWindow(), null, 'Access is denied before the one-hour window')
context.intakeSchedules[0].start = new Date(now.getTime() - 60 * 60 * 1000)
context.intakeSchedules[0].end = now
assert.ok(context.activeScheduledIntakeWindow(), 'Access lasts through the shift end')
context.intakeSchedules[0].end = new Date(now.getTime() - 1000)
assert.equal(context.activeScheduledIntakeWindow(), null, 'Access ends after the shift')

assert.match(markup, /Intake permissions start 60 minutes before each assigned shift/)
assert.match(source, /Access starts 60 minutes before the shift/)
assert.match(migration, /starts_at - interval ''60 minutes''/)
assert.match(migration, /schedule\.starts_at - interval '60 minutes' and schedule\.ends_at/)
assert.doesNotMatch(migration, /from pg_proc[\s\S]*?where n\.nspname in/)

for (const path of [
  '../database/admin_bidder_editor.sql',
  '../database/admin_leave_request_edit.sql',
  '../database/ghost_bidding.sql',
  '../database/round_one_flexible_week_buckets.sql',
  '../database/round_two_three_rdo_limits.sql',
  '../database/round_four_holiday_allowances.sql',
]) {
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /starts_at - interval '15 minutes'/, `${path} still uses the old window`)
  assert.match(sql, /starts_at - interval '60 minutes'/)
}

console.log('Scheduled Intake access window regression checks passed.')
