import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const start = source.indexOf('function buildIntakeScheduleIcs(schedules) {')
const end = source.indexOf('\nfunction fallbackInitials(', start)
assert.ok(start >= 0 && end > start)

const schedules = [
  { id: 'shift-one', initials: 'OC', area: 'All Areas', start: new Date('2026-10-07T18:30:00Z'), end: new Date('2026-10-08T02:30:00Z') },
  { id: 'shift-two', initials: 'OC', area: 'Area A', start: new Date('2026-10-08T16:00:00Z'), end: new Date('2026-10-09T00:00:00Z') },
  { id: 'other-rep', initials: 'VN', area: 'Area A', start: new Date('2026-10-08T14:00:00Z'), end: new Date('2026-10-08T22:00:00Z') },
]
let downloadName = ''
let downloadBlob
const context = {
  BID_YEAR: 2026,
  currentUser: { initials: 'OC' },
  intakeSchedules: schedules,
  Blob,
  URL: { createObjectURL(blob) { downloadBlob = blob; return 'blob:test' }, revokeObjectURL() {} },
  document: {
    createElement() { return { click() { downloadName = this.download }, remove() {} } },
    body: { appendChild() {} },
  },
  icsTimestamp(date = new Date()) { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') },
  escapeIcsText(value) { return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n') },
  dateKeyFromDate(date) { return date.toISOString().slice(0, 10) },
}
const { downloadIntakeScheduleIcs } = runInNewContext(`${source.slice(start, end)}\n({ downloadIntakeScheduleIcs })`, context)

downloadIntakeScheduleIcs()
let ics = await downloadBlob.text()
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2)
assert.match(ics, /DTSTART:20261007T183000Z\r\nDTEND:20261008T023000Z/)
assert.match(ics, /LOCATION:2555 E\. Ave P\\, Palmdale\\, Ca 93550/)
assert.match(downloadName, /intake-schedule\.ics$/)

downloadIntakeScheduleIcs('shift-two')
ics = await downloadBlob.text()
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1)
assert.match(ics, /DTSTART:20261008T160000Z\r\nDTEND:20261009T000000Z/)
assert.doesNotMatch(ics, /shift-one/)
assert.match(downloadName, /intake-2026-10-08\.ics$/)

assert.match(source, /data-download-intake-schedule aria-label="Download all your intake assignments/)
assert.match(source, /data-download-intake-schedule="\$\{escapeHtml\(schedule\.id\)\}"/)
console.log('Intake schedule calendar downloads passed.')
