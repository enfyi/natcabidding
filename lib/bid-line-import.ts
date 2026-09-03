import JSZip from 'jszip'
import type { BidLineImportPreview, BidLineImportRow } from './bid-line-import-types'

const MAX_IMPORT_ROWS = 500
const DAY_HEADERS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

const HEADER_ALIASES: Record<string, string> = {
  line: 'line_code',
  line_number: 'line_code',
  line_no: 'line_code',
  type: 'line_type',
  fatigue: 'fatigue_group',
  fatigue_grouping: 'fatigue_group',
  fourten: 'four_ten',
  four_10: 'four_ten',
  '4_10': 'four_ten',
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
}

export class BidLineImportError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('The bid-line file contains validation errors.')
    this.issues = issues
  }
}

function normalizeHeader(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return HEADER_ALIASES[normalized] || normalized
}

function csvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]

    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function decodedXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function xmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}=["']([^"']*)["']`, 'i'))
  return match ? decodedXml(match[1]) : ''
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || ''
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

function sharedStringValues(xml: string) {
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)].map((match) =>
    [...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)]
      .map((textMatch) => decodedXml(textMatch[1]))
      .join(''),
  )
}

function worksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = []

  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    const values: string[] = []

    for (const cellMatch of rowMatch[1].matchAll(/<((?:\w+:)?c)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi)) {
      const attributes = cellMatch[2]
      const contents = cellMatch[3] || ''
      const reference = xmlAttribute(attributes, 'r')
      const type = xmlAttribute(attributes, 't')
      const index = columnIndex(reference)
      if (index < 0) continue

      const inlineText = [...contents.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)]
        .map((match) => decodedXml(match[1]))
        .join('')
      const rawValue = contents.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1] || ''
      const decodedValue = decodedXml(rawValue)

      if (type === 's') values[index] = sharedStrings[Number(decodedValue)] || ''
      else if (type === 'inlineStr') values[index] = inlineText
      else if (type === 'b') values[index] = decodedValue === '1' ? 'TRUE' : 'FALSE'
      else values[index] = inlineText || decodedValue
    }

    if (values.some((value) => String(value ?? '').trim())) rows.push(values)
  }

  return rows
}

function normalizedWorksheetPath(target: string) {
  const withoutLeadingSlash = target.replace(/^\//, '')
  if (withoutLeadingSlash.startsWith('xl/')) return withoutLeadingSlash
  return `xl/${withoutLeadingSlash.replace(/^\.\//, '')}`
}

type SpreadsheetSheet = { name: string; rows: string[][] }

export async function readSpreadsheetSheets(file: File): Promise<SpreadsheetSheet[]> {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'csv') {
    return [{ name: 'Bid Lines', rows: csvRows(await file.text()) }]
  }

  if (extension !== 'xlsx') {
    throw new BidLineImportError(['Upload an .xlsx or .csv file. Legacy .xls files are not supported.'])
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  const relationshipsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relationshipsXml) {
    throw new BidLineImportError(['The Excel file is missing its workbook definition.'])
  }

  const relationships = new Map<string, string>()
  for (const relationship of relationshipsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    relationships.set(xmlAttribute(relationship[1], 'Id'), xmlAttribute(relationship[1], 'Target'))
  }

  const sheets = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?\s*>/gi)].map((match) => ({
    name: xmlAttribute(match[1], 'name'),
    relationshipId: xmlAttribute(match[1], 'r:id'),
  }))
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string')
  const sharedStrings = sharedStringsXml ? sharedStringValues(sharedStringsXml) : []
  const readableSheets: SpreadsheetSheet[] = []

  for (const sheet of sheets) {
    const target = relationships.get(sheet.relationshipId)
    if (!target) continue
    const worksheetXml = await zip.file(normalizedWorksheetPath(target))?.async('string')
    if (!worksheetXml) continue
    readableSheets.push({ name: sheet.name, rows: worksheetRows(worksheetXml, sharedStrings) })
  }

  if (!readableSheets.length) throw new BidLineImportError(['The workbook does not contain a readable worksheet.'])
  return readableSheets
}

export async function readSpreadsheetRows(file: File, preferredSheetName = 'Bid Lines') {
  const sheets = await readSpreadsheetSheets(file)
  return sheets.find((sheet) => sheet.name.toLowerCase() === preferredSheetName.toLowerCase())?.rows || sheets[0].rows
}

function rowReference(row: number | string) {
  return typeof row === 'number' ? `Row ${row}` : row
}

function booleanValue(rawValue: string, label: string, row: number | string, issues: string[]) {
  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) return false
  if (['yes', 'y', 'true', '1'].includes(normalized)) return true
  if (['no', 'n', 'false', '0'].includes(normalized)) return false
  issues.push(`${rowReference(row)}: ${label} must be Yes or No.`)
  return false
}

function optionalBooleanValue(rawValue: string, label: string, row: number | string, issues: string[]) {
  if (!rawValue.trim()) return null
  return booleanValue(rawValue, label, row, issues)
}

function normalizedFatigueGroup(rawValue: string, row: number | string, issues: string[]) {
  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'a') return 'A' as const
  if (normalized === 'b') return 'B' as const
  if (normalized === 'c') return 'C' as const
  if (normalized === 'c only' || normalized === 'c-only') return 'C only' as const
  issues.push(`${rowReference(row)}: fatigue_group must be A, B, C, or C only.`)
  return 'C' as const
}

function normalizedShiftValue(rawValue: string) {
  const normalized = rawValue.normalize('NFKC').replace(/\u00a0/g, ' ').trim().toUpperCase()
  return normalized.replace(/[^A-Z0-9]/g, '') === 'RDO' ? 'RDO' : normalized
}

export async function parseBidLineImport(file: File): Promise<BidLineImportPreview> {
  const workbookSheets = await readSpreadsheetSheets(file)
  const issues: string[] = []
  const warnings: string[] = []
  const lines: BidLineImportRow[] = []
  const seenLineCodes = new Set<string>()

  const normalizedSheetName = (name: string) => name.trim().toUpperCase().replace(/[\s_]+/g, '-')
  const separatedSheets = ['CPC', 'R-DEV', 'D-DEV'].map((name) => ({
    group: name,
    sheet: workbookSheets.find((sheet) => normalizedSheetName(sheet.name) === name),
  })).filter((entry) => entry.sheet)
  const sheetsToParse = separatedSheets.length
    ? separatedSheets.map(({ group, sheet }) => ({ group, sheet: sheet as SpreadsheetSheet }))
    : [{ group: 'LEGACY', sheet: workbookSheets.find((sheet) => sheet.name.toLowerCase() === 'bid lines') || workbookSheets[0] }]

  for (const { group, sheet } of sheetsToParse) {
    const rows = sheet.rows
    if (!rows.length) continue

    const headerIndex = rows.findIndex((row) => row.map(normalizeHeader).includes('line_code'))
    if (headerIndex < 0) {
      issues.push(`${sheet.name}: a header row containing line_code (or Line) could not be found.`)
      continue
    }

    const headers = rows[headerIndex].map(normalizeHeader)
    const headerMap = new Map(headers.map((header, index) => [header, index]))
    const requiredHeaders = ['line_code', ...(group === 'CPC' || group === 'LEGACY' ? ['pattern'] : []), ...DAY_HEADERS]
    const missingHeaders = requiredHeaders.filter((header) => !headerMap.has(header))
    if (missingHeaders.length) {
      issues.push(`${sheet.name}: missing required columns: ${missingHeaders.join(', ')}.`)
      continue
    }

    const valueFor = (row: string[], header: string) => {
      const index = headerMap.get(header)
      return index === undefined ? '' : String(row[index] ?? '').trim()
    }

    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const sourceRow = headerIndex + offset + 2
      if (!row.some((value) => String(value ?? '').trim())) return

      const rowLabel = `${sheet.name} row ${sourceRow}`
      const lineCode = valueFor(row, 'line_code')
      const lineTypeRaw = group === 'CPC' ? 'CPC' : group === 'R-DEV' || group === 'D-DEV' ? 'DEV' : (valueFor(row, 'line_type') || 'CPC').toUpperCase()
      const pattern = group === 'R-DEV' || group === 'D-DEV' ? group : valueFor(row, 'pattern').toUpperCase()
      const midRaw = (valueFor(row, 'mid') || 'No').toUpperCase()
      const days = DAY_HEADERS.map((day) => normalizedShiftValue(valueFor(row, day))) as BidLineImportRow['days']

      if (!lineCode || lineCode.length > 40) issues.push(`${rowLabel}: line_code is required and must be 40 characters or fewer.`)
      if (!pattern || pattern.length > 40) issues.push(`${rowLabel}: pattern is required and must be 40 characters or fewer.`)
      if (lineTypeRaw !== 'CPC' && lineTypeRaw !== 'DEV') issues.push(`${rowLabel}: line_type must be CPC or DEV.`)
      if (midRaw !== 'NO' && midRaw !== 'BID') issues.push(`${rowLabel}: mid must be No or BID.`)
      if (seenLineCodes.has(lineCode.toLowerCase())) issues.push(`${rowLabel}: line code ${lineCode} appears more than once in the workbook.`)
      days.forEach((shift, weekday) => {
        if (!shift || shift.length > 20) issues.push(`${rowLabel}: ${DAY_HEADERS[weekday]} must contain a shift code or RDO.`)
      })

      seenLineCodes.add(lineCode.toLowerCase())
      lines.push({
        sourceSheet: sheet.name,
        sourceRow,
        line_code: lineCode,
        line_type: lineTypeRaw === 'DEV' ? 'DEV' : 'CPC',
        pattern,
        fatigue_group: normalizedFatigueGroup(valueFor(row, 'fatigue_group'), rowLabel, issues),
        mid: midRaw === 'BID' ? 'BID' : 'No',
        aws: optionalBooleanValue(valueFor(row, 'aws'), 'aws', rowLabel, issues),
        four_ten: booleanValue(valueFor(row, 'four_ten'), 'four_ten', rowLabel, issues),
        flex: optionalBooleanValue(valueFor(row, 'flex'), 'flex', rowLabel, issues),
        days,
      })
    })

    if (group === 'LEGACY' && !headerMap.has('line_type')) warnings.push('line_type was not included, so CPC was used.')
    if (!headerMap.has('fatigue_group')) warnings.push(`${sheet.name}: fatigue_group was not included; existing values stay unchanged and new lines default to C.`)
    if (!headerMap.has('aws')) warnings.push(`${sheet.name}: aws was not included; existing values stay unchanged and new lines default to No.`)
    if (!headerMap.has('flex')) warnings.push(`${sheet.name}: flex was not included; existing values stay unchanged and new lines default to Yes.`)
    if (!headerMap.has('mid')) warnings.push(`${sheet.name}: mid was not included, so No was used.`)
  }

  if (!lines.length) issues.push('The file does not contain any bid-line rows below the header.')
  if (lines.length > MAX_IMPORT_ROWS) issues.push(`The file contains ${lines.length} rows; the maximum is ${MAX_IMPORT_ROWS}.`)

  if (issues.length) throw new BidLineImportError(issues.slice(0, 100))

  return { fileName: file.name, lines, warnings }
}
