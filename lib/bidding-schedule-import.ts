import JSZip from 'jszip'
import { renderArchiveWorkbook } from './archive-web-workbook'
import { sortSchedule, validDate, validateSchedule, type ScheduleEvent } from '../bidding-schedule.mjs'

function date(value: string) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/)
  const result = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : value.trim()
  return validDate(result) ? result : null
}
function phase(value: string): Pick<ScheduleEvent, 'label' | 'kind'> | null {
  const label = value.trim().replace(/\s+/g, ' ')
  if (/^round\s+[1-7](?:\s*(?:&|\/|and)\s*[1-7])?$/i.test(label)) return { label: label.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), kind: 'round' }
  if (/^validation(?: week)?$/i.test(label)) return { label: /week/i.test(label) ? 'Validation Week' : 'Validation', kind: 'validation' }
  if (/^holiday$/i.test(label)) return { label: 'Holiday', kind: 'holiday' }
  if (/^change week$/i.test(label)) return { label: 'Change Week', kind: 'change' }
  return null
}
export async function parseBiddingSchedule(file: File) {
  if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > 4 * 1024 * 1024) throw new Error('Choose an Excel .xlsx workbook of 4 MB or smaller.')
  const workbook = await renderArchiveWorkbook(await JSZip.loadAsync(await file.arrayBuffer()))
  const candidates = workbook.sheets.filter(sheet => sheet.rows.some(row => row.cells.some(cell => phase(cell.value))))
  const sheet = candidates.find(sheet => /^schedule print$/i.test(sheet.name)) || (candidates.length === 1 ? candidates[0] : null)
  if (!sheet) throw new Error('No unambiguous schedule worksheet was found. Name the calendar worksheet “Schedule Print”.')
  const events: ScheduleEvent[] = []
  const warnings = ['The import uses the dated calendar bands. Side notes and colors do not set dates. Review every phase before publishing.']
  for (let i = 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]
    const dates = new Map(sheet.rows[i - 1].cells.map(cell => [cell.column, date(cell.value)]))
    if ([...dates.values()].filter(Boolean).length < 2) continue
    for (const cell of row.cells) {
      // Only the Sunday–Saturday calendar columns; never the left or right notes.
      if (cell.column < 1 || cell.column > 7) continue
      const entry = phase(cell.value)
      if (!entry) {
        if (cell.value.trim() && cell.value.trim().toLowerCase() !== 'x') throw new Error(`Unrecognized phase “${cell.value}” at row ${row.number}. Use Round 1–7, Validation, Holiday, Change Week, or Validation Week.`)
        continue
      }
      const start = dates.get(cell.column)
      const end = dates.get(cell.column + (cell.colSpan || 1) - 1)
      if (!start || !end) throw new Error(`Missing calendar dates above “${entry.label}” at row ${row.number}. Recalculate and save the workbook in Excel before importing.`)
      events.push({ ...entry, start, end })
    }
  }
  const merged: ScheduleEvent[] = []
  for (const event of sortSchedule(events)) {
    const previous = merged.at(-1)
    if (previous && previous.label === event.label && previous.kind === event.kind && Date.parse(event.start) - Date.parse(previous.end) === 86400000) previous.end = event.end
    else merged.push({ ...event })
  }
  const issues = validateSchedule(merged)
  if (issues.length) throw new Error(issues.join(' '))
  return { events: merged, sheet: sheet.name, warnings }
}
