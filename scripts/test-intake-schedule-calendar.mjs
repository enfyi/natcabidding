import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('../bidding.css', import.meta.url), 'utf8')

assert.match(source, /let scheduleActiveDate = new Date\(\)/)
assert.match(source, /const visibleMonths = \[0, 1\]\.map/)
assert.match(source, /scheduleActiveDate\.getMonth\(\) \+ offset/)
assert.match(source, /visibleMonths\.map\(\(month\) => renderScheduleMonthCard/)
assert.match(source, /const nextMonth = new Date\(scheduleActiveDate\.getFullYear\(\), scheduleActiveDate\.getMonth\(\) \+ 1, 1\)/)
assert.match(styles, /\.schedule-calendar\.month-view \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.schedule-calendar\.month-view \{[\s\S]*grid-template-columns: 1fr/)

console.log('Two-month intake calendar regression checks passed.')
