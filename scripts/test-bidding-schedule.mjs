import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { calendarWeeks, scheduleStatus, todayInLA, validateSchedule } from '../bidding-schedule.mjs'

// Node's native TypeScript loader with the extensionless imports used by this app.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && existsSync(new URL(`${specifier}.ts`, context.parentURL))) specifier += '.ts'
  return next(specifier, context)
} })
const { parseBiddingSchedule } = await import('../lib/bidding-schedule-import.ts')
const entries = [
  { label: 'Round 1', kind: 'round', start: '2026-10-05', end: '2026-10-11' },
  { label: 'Holiday', kind: 'holiday', start: '2026-10-12', end: '2026-10-12' },
  { label: 'Round 1', kind: 'round', start: '2026-10-13', end: '2026-10-14' },
]
assert.deepEqual(validateSchedule(entries), [])
assert.ok(validateSchedule([...entries, { ...entries[0], start: '2026-10-11' }]).some(s => /overlaps/.test(s)))
assert.ok(validateSchedule([{ ...entries[0], start: '2026-02-30' }]).length)
assert.ok(validateSchedule([{ ...entries[0], end: '2026-01-01' }]).length)
assert.ok(validateSchedule([{ ...entries[0], end: '2028-01-01' }]).length)
assert.ok(validateSchedule([{ ...entries[0], kind: 'script' }]).length)
assert.ok(validateSchedule([]).length)
assert.equal(scheduleStatus(entries, '2026-10-04').next.label, 'Round 1')
assert.equal(scheduleStatus(entries, '2026-10-11').current.label, 'Round 1')
assert.equal(scheduleStatus(entries, '2026-10-12').current.label, 'Holiday')
assert.equal(scheduleStatus(entries, '2026-10-14').complete, false)
assert.equal(scheduleStatus(entries, '2026-10-15').complete, true)
assert.equal(todayInLA(Date.parse('2026-11-21T07:30:00Z')), '2026-11-20')
assert.equal(calendarWeeks(entries)[0][0].date, '2026-10-04')
assert.equal(calendarWeeks(entries).at(-1).at(-1).date, '2026-10-17')

async function workbook(label = 'ROUND 1') {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Schedule Print" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>10/05/2026</t></is></c><c r="C1" t="inlineStr"><is><t>10/06/2026</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Rd. 1 St. 10/01</t></is></c><c r="B2" t="inlineStr"><is><t>${label}</t></is></c></row></sheetData><mergeCells><mergeCell ref="B2:C2"/></mergeCells></worksheet>`)
  return new File([await zip.generateAsync({ type: 'uint8array' })], 'schedule.xlsx')
}
const parsed = await parseBiddingSchedule(await workbook())
assert.deepEqual(parsed.events, [{ ...entries[0], end: '2026-10-06' }])
await assert.rejects(() => parseBiddingSchedule(workbook), /Choose an Excel/)
await assert.rejects(() => parseBiddingSchedule(new File(['x'], 'schedule.xls')), /Choose an Excel/)
const unknown = await workbook('ROUND 99')
await assert.rejects(() => parseBiddingSchedule(unknown), /schedule worksheet/)
if (process.argv[2]) {
  const actual = await parseBiddingSchedule(new File([readFileSync(process.argv[2])], 'schedule.xlsx'))
  assert.equal(actual.events.length, 16)
  assert.deepEqual(actual.events[4], { label: 'Round 2', kind: 'round', start: '2026-10-16', end: '2026-10-24' })
  assert.deepEqual(actual.events.at(-1), { label: 'Round 7', kind: 'round', start: '2026-12-13', end: '2026-12-19' })
  console.log('Supplied workbook: all 16 ranges imported; merged bands and adjacent weeks verified.')
}
console.log('Annual schedule: date validation, overlap rejection, inclusive boundaries, LA timezone, calendar weeks, Excel spans, and invalid files passed.')
