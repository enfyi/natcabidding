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

    for (const cellMatch of rowMatch[1].matchAll(/<((?:\w+:)?c)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const attributes = cellMatch[2]
      const contents = cellMatch[3]
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

export async function readSpreadsheetRows(file: File, preferredSheetName = 'Bid Lines') {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'csv') {
    return csvRows(await file.text())
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
  const selectedSheet = sheets.find((sheet) => sheet.name.toLowerCase() === preferredSheetName.toLowerCase()) || sheets[0]
  const target = selectedSheet ? relationships.get(selectedSheet.relationshipId) : ''
  if (!target) throw new BidLineImportError(['The workbook does not contain a readable worksheet.'])

  const worksheetXml = await zip.file(normalizedWorksheetPath(target))?.async('string')
  if (!worksheetXml) throw new BidLineImportError([`The ${selectedSheet.name} worksheet could not be read.`])

  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string')
  return worksheetRows(worksheetXml, sharedStringsXml ? sharedStringValues(sharedStringsXml) : [])
}

function booleanValue(rawValue: string, label: string, rowNumber: number, issues: string[]) {
  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) return false
  if (['yes', 'y', 'true', '1'].includes(normalized)) return true
  if (['no', 'n', 'false', '0'].includes(normalized)) return false
  issues.push(`Row ${rowNumber}: ${label} must be Yes or No.`)
  return false
}

function normalizedFatigueGroup(rawValue: string, rowNumber: number, issues: string[]) {
  const normalized = (rawValue || 'C').trim().toLowerCase()
  if (normalized === 'a') return 'A' as const
  if (normalized === 'b') return 'B' as const
  if (normalized === 'c') return 'C' as const
  if (normalized === 'c only' || normalized === 'c-only') return 'C only' as const
  issues.push(`Row ${rowNumber}: fatigue_group must be A, B, C, or C only.`)
  return 'C' as const
}

export async function parseBidLineImport(file: File): Promise<BidLineImportPreview> {
  const rows = await readSpreadsheetRows(file)
  const issues: string[] = []
  const warnings: string[] = []

  if (!rows.length) throw new BidLineImportError(['The uploaded file is empty.'])

  const headerIndex = rows.findIndex((row) => row.map(normalizeHeader).includes('line_code'))
  if (headerIndex < 0) {
    throw new BidLineImportError(['A header row containing line_code (or Line) could not be found.'])
  }

  const headers = rows[headerIndex].map(normalizeHeader)
  const headerMap = new Map(headers.map((header, index) => [header, index]))
  const requiredHeaders = ['line_code', 'pattern', ...DAY_HEADERS]
  const missingHeaders = requiredHeaders.filter((header) => !headerMap.has(header))

  if (missingHeaders.length) {
    throw new BidLineImportError([`Missing required columns: ${missingHeaders.join(', ')}.`])
  }

  const valueFor = (row: string[], header: string) => {
    const index = headerMap.get(header)
    return index === undefined ? '' : String(row[index] ?? '').trim()
  }

  const lines: BidLineImportRow[] = []
  const seenLineCodes = new Set<string>()

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const sourceRow = headerIndex + offset + 2
    if (!row.some((value) => String(value ?? '').trim())) return

    const lineCode = valueFor(row, 'line_code')
    const pattern = valueFor(row, 'pattern').toUpperCase()
    const lineTypeRaw = (valueFor(row, 'line_type') || 'CPC').toUpperCase()
    const midRaw = (valueFor(row, 'mid') || 'No').toUpperCase()
    const days = DAY_HEADERS.map((day) => {
      const value = valueFor(row, day).toUpperCase()
      return value === 'R.D.O.' || value === 'RDO.' ? 'RDO' : value
    }) as BidLineImportRow['days']

    if (!lineCode || lineCode.length > 40) issues.push(`Row ${sourceRow}: line_code is required and must be 40 characters or fewer.`)
    if (!pattern || pattern.length > 40) issues.push(`Row ${sourceRow}: pattern is required and must be 40 characters or fewer.`)
    if (lineTypeRaw !== 'CPC' && lineTypeRaw !== 'DEV') issues.push(`Row ${sourceRow}: line_type must be CPC or DEV.`)
    if (midRaw !== 'NO' && midRaw !== 'BID') issues.push(`Row ${sourceRow}: mid must be No or BID.`)
    if (seenLineCodes.has(lineCode.toLowerCase())) issues.push(`Row ${sourceRow}: line code ${lineCode} appears more than once.`)
    days.forEach((shift, weekday) => {
      if (!shift || shift.length > 20) issues.push(`Row ${sourceRow}: ${DAY_HEADERS[weekday]} must contain a shift code or RDO.`)
    })

    seenLineCodes.add(lineCode.toLowerCase())
    lines.push({
      sourceRow,
      line_code: lineCode,
      line_type: lineTypeRaw === 'DEV' ? 'DEV' : 'CPC',
      pattern,
      fatigue_group: normalizedFatigueGroup(valueFor(row, 'fatigue_group'), sourceRow, issues),
      mid: midRaw === 'BID' ? 'BID' : 'No',
      aws: booleanValue(valueFor(row, 'aws'), 'aws', sourceRow, issues),
      four_ten: booleanValue(valueFor(row, 'four_ten'), 'four_ten', sourceRow, issues),
      flex: booleanValue(valueFor(row, 'flex'), 'flex', sourceRow, issues),
      days,
    })
  })

  if (!lines.length) issues.push('The file does not contain any bid-line rows below the header.')
  if (lines.length > MAX_IMPORT_ROWS) issues.push(`The file contains ${lines.length} rows; the maximum is ${MAX_IMPORT_ROWS}.`)

  if (!headerMap.has('line_type')) warnings.push('line_type was not included, so CPC was used.')
  if (!headerMap.has('fatigue_group')) warnings.push('fatigue_group was not included, so C was used.')
  if (!headerMap.has('mid')) warnings.push('mid was not included, so No was used.')

  if (issues.length) throw new BidLineImportError(issues.slice(0, 100))

  return { fileName: file.name, lines, warnings }
}
