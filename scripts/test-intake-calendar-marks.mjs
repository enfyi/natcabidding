import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('../bidding.css', import.meta.url), 'utf8')
const schema = await readFile(new URL('../supabase/migrations/20261002220000_intake_calendar_marks.sql', import.meta.url), 'utf8')

const start = source.indexOf('function renderScheduleDayButton(')
const end = source.indexOf('\nfunction renderScheduleMonthCard(', start)
assert.ok(start >= 0 && end > start)

for (const [kind, label] of [
  ['holiday', 'Holiday'],
  ['natca_validation', 'NATCA Validation'],
  ['faa_validation', 'FAA Validation'],
]) {
  const context = {
    dateKeyFromDate: () => '2026-10-05',
    schedulesForDateKey: () => [{ initials: 'OC' }],
    intakeCalendarMarks: new Map([['2026-10-05', kind]]),
    INTAKE_CALENDAR_MARK_LABELS: {
      holiday: 'Holiday',
      natca_validation: 'NATCA Validation',
      faa_validation: 'FAA Validation',
    },
    currentUser: { initials: 'OC' },
    monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'],
    renderScheduleDayAssignments: () => '<span class="assignment">OC</span>',
    renderScheduleTooltip: () => '',
  }
  const render = runInNewContext(`${source.slice(start, end)}\nrenderScheduleDayButton`, context)
  const day = render(new Date(2026, 9, 5), false, { showAssignments: true })
  assert.match(day, new RegExp(`intake-mark-${kind}`))
  assert.ok(day.includes(label))
  assert.match(day, /has-schedule/)
  assert.match(day, /my-schedule-day/)
  assert.match(styles, new RegExp(`\\.schedule-calendar \\.schedule-day\\.intake-mark-${kind}`))
}

assert.match(schema, /enable row level security/)
assert.match(schema, /Admins can add intake calendar marks/)
assert.match(schema, /Admins can change intake calendar marks/)
assert.match(schema, /Admins can clear intake calendar marks/)
console.log('Intake calendar marking checks passed.')
