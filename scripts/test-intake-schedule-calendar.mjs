import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('../bidding.css', import.meta.url), 'utf8')
const markup = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')

assert.match(source, /let scheduleActiveDate = new Date\(\)/)
assert.match(markup, /data-schedule-calendar-view="year"[^>]*>Year<\/button>[\s\S]*data-schedule-calendar-view="two-month"[^>]*>2 Months<\/button>[\s\S]*data-schedule-calendar-view="month"[^>]*>Month<\/button>[\s\S]*data-schedule-calendar-view="week"[^>]*>Week<\/button>/)
assert.match(source, /const monthCount = scheduleCalendarView === "two-month" \? 2 : 1/)
assert.match(source, /const visibleMonths = Array\.from\(\{ length: monthCount \}/)
assert.match(source, /scheduleActiveDate\.getMonth\(\) \+ offset/)
assert.match(source, /visibleMonths\.map\(\(month\) => renderScheduleMonthCard/)
assert.match(source, /const nextMonth = new Date\(scheduleActiveDate\.getFullYear\(\), scheduleActiveDate\.getMonth\(\) \+ 1, 1\)/)
const moveStart = source.indexOf('function moveSchedulePeriod(direction) {')
const moveEnd = source.indexOf('\nfunction renderIntakeSchedule()', moveStart)
assert.ok(moveStart >= 0 && moveEnd > moveStart)
const navigation = { scheduleCalendarView: 'two-month', scheduleActiveDate: new Date(2026, 0, 31), renderIntakeSchedule() {} }
runInNewContext(`${source.slice(moveStart, moveEnd)}\nmoveSchedulePeriod(1);`, navigation)
assert.equal(navigation.scheduleActiveDate.getMonth(), 1)
runInNewContext(`${source.slice(moveStart, moveEnd)}\nmoveSchedulePeriod(-1);`, navigation)
assert.equal(navigation.scheduleActiveDate.getMonth(), 0)
assert.match(styles, /\.schedule-calendar\.month-view \{\s*grid-template-columns: minmax\(0, 1fr\)/)
assert.match(styles, /\.schedule-calendar\.two-month-view \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.schedule-calendar:is\(\.month-view, \.two-month-view\) \{[\s\S]*grid-template-columns: 1fr/)

console.log('Intake calendar view regression checks passed.')
