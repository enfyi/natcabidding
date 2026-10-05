import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const schema = await readFile(new URL('../supabase/migrations/20261002222000_limit_intake_calendar_marks_to_team.sql', import.meta.url), 'utf8')

const guardStart = source.indexOf('function canViewIntakeSchedule() {')
const guardEnd = source.indexOf('\nasync function refreshIntakeScheduleMembership()', guardStart)
assert.ok(guardStart >= 0 && guardEnd > guardStart)

const context = {
  currentUser: { initials: 'OC', supabaseProfileId: 'profile-1', systemAdmin: false },
  intakeTeamInitials: new Set(['OC']),
  hasSystemAdminAccess() { return this.currentUser.systemAdmin },
}
context.hasSystemAdminAccess = () => context.currentUser.systemAdmin
const canView = runInNewContext(`${source.slice(guardStart, guardEnd)}\ncanViewIntakeSchedule`, context)
assert.equal(canView(), true)
context.intakeTeamInitials.delete('OC')
assert.equal(canView(), false)
context.currentUser.systemAdmin = true
assert.equal(canView(), true)

const schedulesStart = source.indexOf('function applyIntakeSchedulesFromDatabase(')
const schedulesEnd = source.indexOf('\nfunction loadIntakeSchedules(', schedulesStart)
assert.ok(schedulesStart >= 0 && schedulesEnd > schedulesStart)
const schedules = []
const team = new Set()
const applySchedules = runInNewContext(`${source.slice(schedulesStart, schedulesEnd)}\napplyIntakeSchedulesFromDatabase`, {
  intakeSchedules: schedules,
  intakeTeamInitials: team,
  controllerName: () => 'Former member',
  INTAKE_SCHEDULE_AREA: 'All Areas',
})
applySchedules([{ id: 'old-shift', initials: 'VN', starts_at: '2026-10-05T14:00:00Z', ends_at: '2026-10-05T22:00:00Z' }])
assert.equal(schedules.length, 1)
assert.equal(team.has('VN'), false)

assert.match(schema, /public\.is_current_intake_or_admin\(\)/)
assert.match(source, /trigger\.dataset\.page === "intake-schedule" && !await refreshIntakeScheduleMembership\(\)/)
assert.match(source, /element\.hidden = !canOpenIntakeSchedule/)
assert.match(source, /pageName === "intake-schedule" && !canViewIntakeSchedule\(\)/)
assert.match(source, /!supabaseState\.authUserId \|\| !canViewIntakeSchedule\(\)/)
console.log('Intake calendar membership checks passed.')
