import { BidLineImportError, readSpreadsheetRows } from './bid-line-import'
import type { BidTimeImportPreview, BidTimeImportRow } from './bid-time-import-types'

const MAX_IMPORT_ROWS = 500
const ROUND_HEADERS = ['round_1_start', 'round_2_start', 'round_3_start', 'round_4_start'] as const

const HEADER_ALIASES: Record<string, string> = {
  rank: 'seniority_rank',
  seniority: 'seniority_rank',
  seniority_number: 'seniority_rank',
  initials_optional: 'initials',
  round_1: 'round_1_start',
  round1: 'round_1_start',
  round_2: 'round_2_start',
  round2: 'round_2_start',
  round_3: 'round_3_start',
  round3: 'round_3_start',
  round_4: 'round_4_start',
  round4: 'round_4_start',
}

export class BidTimeImportError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('The bid-time file contains validation errors.')
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

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function normalizedDateTime(year: number, month: number, day: number, hour: number, minute: number) {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
  ) return null

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

function excelSerialDateTime(value: number) {
  if (!Number.isFinite(value) || value < 1 || value > 2958465) return null
  const milliseconds = Math.round(value * 86_400_000)
  const date = new Date(Date.UTC(1899, 11, 30) + milliseconds)
  return normalizedDateTime(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  )
}

function parsedDateTime(rawValue: string) {
  const value = rawValue.trim()
  if (!value) return null

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return excelSerialDateTime(Number(value))
  }

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/)
  if (isoMatch) {
    return normalizedDateTime(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      Number(isoMatch[4]),
      Number(isoMatch[5]),
    )
  }

  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i)
  if (!usMatch) return null

  let hour = Number(usMatch[4])
  const meridiem = usMatch[6]?.toUpperCase()
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (hour === 12) hour = 0
    if (meridiem === 'PM') hour += 12
  }

  return normalizedDateTime(Number(usMatch[3]), Number(usMatch[1]), Number(usMatch[2]), hour, Number(usMatch[5]))
}

export async function parseBidTimeImport(file: File): Promise<BidTimeImportPreview> {
  let rows: string[][]
  try {
    rows = await readSpreadsheetRows(file, 'Bid Times')
  } catch (error) {
    if (error instanceof BidLineImportError) throw new BidTimeImportError(error.issues)
    throw error
  }

  const issues: string[] = []
  const warnings: string[] = []
  if (!rows.length) throw new BidTimeImportError(['The uploaded file is empty.'])

  const headerIndex = rows.findIndex((row) => row.map(normalizeHeader).includes('seniority_rank'))
  if (headerIndex < 0) {
    throw new BidTimeImportError(['A header row containing seniority_rank (or Rank) could not be found.'])
  }

  const headers = rows[headerIndex].map(normalizeHeader)
  const headerMap = new Map(headers.map((header, index) => [header, index]))
  const availableRoundHeaders = ROUND_HEADERS.filter((header) => headerMap.has(header))
  if (!availableRoundHeaders.length) {
    throw new BidTimeImportError([`Include at least one round column: ${ROUND_HEADERS.join(', ')}.`])
  }

  const valueFor = (row: string[], header: string) => {
    const index = headerMap.get(header)
    return index === undefined ? '' : String(row[index] ?? '').trim()
  }

  const bidders: BidTimeImportRow[] = []
  const seenRanks = new Set<number>()
  let windowCount = 0

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const sourceRow = headerIndex + offset + 2
    if (!row.some((value) => String(value ?? '').trim())) return

    const rankRaw = valueFor(row, 'seniority_rank')
    const rank = Number(rankRaw)
    const initials = valueFor(row, 'initials').toUpperCase()
    const roundStarts = ROUND_HEADERS.map((header, roundIndex) => {
      const rawValue = valueFor(row, header)
      if (!rawValue) return null
      const parsed = parsedDateTime(rawValue)
      if (!parsed) {
        issues.push(`Row ${sourceRow}: Round ${roundIndex + 1} must be a valid date and time, such as 2026-10-01 07:00.`)
        return null
      }
      windowCount += 1
      return parsed
    }) as BidTimeImportRow['round_starts']

    if (!Number.isInteger(rank) || rank < 1 || rank > 1000) {
      issues.push(`Row ${sourceRow}: seniority_rank must be a whole number from 1 to 1000.`)
    } else if (seenRanks.has(rank)) {
      issues.push(`Row ${sourceRow}: seniority rank ${rank} appears more than once.`)
    }
    if (initials.length > 12) issues.push(`Row ${sourceRow}: initials must be 12 characters or fewer.`)
    if (!roundStarts.some(Boolean)) issues.push(`Row ${sourceRow}: enter at least one round start time.`)

    if (Number.isInteger(rank)) seenRanks.add(rank)
    bidders.push({ sourceRow, seniority_rank: rank, initials, round_starts: roundStarts })
  })

  if (!bidders.length) issues.push('The file does not contain any bidder rows below the header.')
  if (bidders.length > MAX_IMPORT_ROWS) issues.push(`The file contains ${bidders.length} rows; the maximum is ${MAX_IMPORT_ROWS}.`)
  if (!headerMap.has('initials')) warnings.push('Initials were not included, so bidders will be matched by area and seniority rank only.')
  if (availableRoundHeaders.length < ROUND_HEADERS.length) warnings.push('Only included round columns will be changed; other rounds remain untouched.')

  if (issues.length) throw new BidTimeImportError(issues.slice(0, 100))
  return { fileName: file.name, bidders, windowCount, warnings }
}
