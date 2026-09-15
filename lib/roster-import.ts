import { BidLineImportError, readSpreadsheetSheets } from './bid-line-import'
import type { RosterImportPreview, RosterImportRow } from './roster-import-types'

const MAX_IMPORT_ROWS = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = new Set(['CPC', 'GL', 'R-DEV', 'D-DEV', 'TMC', 'DEV'])

const HEADER_ALIASES: Record<string, string> = {
  id: 'profile_id',
  bidder_id: 'profile_id',
  area: 'area_code',
  area_label: 'area_code',
  source_sheet: 'area_code',
  rank: 'seniority_rank',
  area_seniority_rank: 'seniority_rank',
  seniority: 'seniority_rank',
  first: 'first_name',
  last: 'last_name',
  e_mail: 'email',
  telephone: 'phone',
  status: 'bid_role',
  role: 'bid_role',
  bid_as: 'bid_role',
  date_of_seniority: 'seniority_date',
}

export class RosterImportError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('The seniority roster contains validation errors.')
    this.issues = issues
  }
}

function normalizeHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return HEADER_ALIASES[normalized] || normalized
}

function normalizedArea(rawValue: string) {
  const value = rawValue.trim().toUpperCase().replace(/^AREA[\s_-]*/, '')
  if (/^[A-F]$/.test(value)) return value
  if (value === 'TMU') return 'TMU'
  return rawValue.trim().toUpperCase()
}

function normalizedRole(rawValue: string, areaCode: string) {
  const value = rawValue.trim().toUpperCase().replace(/\s+/g, '-')
  if (!value) return areaCode === 'TMU' ? 'TMC' : 'CPC'
  if (value === 'RDEV') return 'R-DEV'
  if (value === 'DDEV' || value === 'TMCIT') return areaCode === 'TMU' ? 'DEV' : 'D-DEV'
  return value
}

function parsedBoolean(rawValue: string, fallback: boolean, rowLabel: string, issues: string[]) {
  const value = rawValue.trim().toLowerCase()
  if (!value) return fallback
  if (['yes', 'y', 'true', '1', 'active'].includes(value)) return true
  if (['no', 'n', 'false', '0', 'inactive'].includes(value)) return false
  issues.push(`${rowLabel}: active must be Yes or No.`)
  return fallback
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

function parsedDate(rawValue: string) {
  const value = rawValue.trim()
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000)
    return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return us ? validDate(Number(us[3]), Number(us[1]), Number(us[2])) : null
}

export async function parseRosterImport(file: File): Promise<RosterImportPreview> {
  let sheets
  try {
    sheets = await readSpreadsheetSheets(file)
  } catch (error) {
    if (error instanceof BidLineImportError) throw new RosterImportError(error.issues)
    throw error
  }

  const issues: string[] = []
  const warnings: string[] = []
  const importedRows: RosterImportRow[] = []
  const seenInitials = new Set<string>()
  const seenProfileIds = new Set<string>()
  const seenRanks = new Set<string>()
  const seenEmails = new Set<string>()

  for (const sheet of sheets) {
    const headerIndex = sheet.rows.findIndex((row) => {
      const headers = row.map(normalizeHeader)
      return headers.includes('seniority_rank') && headers.includes('last_name')
    })
    if (headerIndex < 0) continue

    const headers = sheet.rows[headerIndex].map(normalizeHeader)
    const headerMap = new Map(headers.map((header, index) => [header, index]))
    const valueFor = (row: string[], header: string) => {
      const index = headerMap.get(header)
      return index === undefined ? '' : String(row[index] ?? '').trim()
    }

    for (const [offset, row] of sheet.rows.slice(headerIndex + 1).entries()) {
      if (!row.some((value) => String(value ?? '').trim())) continue
      const sourceRow = headerIndex + offset + 2
      const rowLabel = `${sheet.name}, row ${sourceRow}`
      const profileId = valueFor(row, 'profile_id').toLowerCase() || null
      const areaCode = normalizedArea(valueFor(row, 'area_code') || sheet.name)
      const rank = Number(valueFor(row, 'seniority_rank'))
      const firstName = valueFor(row, 'first_name')
      const lastName = valueFor(row, 'last_name')
      const initials = valueFor(row, 'initials').toUpperCase()
      const email = valueFor(row, 'email').toLowerCase() || null
      const phone = valueFor(row, 'phone') || null
      const bidRole = normalizedRole(valueFor(row, 'bid_role'), areaCode)
      const rawDate = valueFor(row, 'seniority_date')
      const seniorityDate = parsedDate(rawDate)
      const active = parsedBoolean(valueFor(row, 'active'), true, rowLabel, issues)

      if (profileId && !UUID_PATTERN.test(profileId)) issues.push(`${rowLabel}: profile_id must be a valid UUID or blank.`)
      if (!/^(A|B|C|D|E|F|TMU)$/.test(areaCode)) issues.push(`${rowLabel}: area_code must be A through F or TMU.`)
      if (!Number.isInteger(rank) || rank < 1 || rank > 1000) issues.push(`${rowLabel}: seniority_rank must be a whole number from 1 to 1000.`)
      if (!firstName) issues.push(`${rowLabel}: first_name is required.`)
      if (!lastName) issues.push(`${rowLabel}: last_name is required.`)
      if (!initials || initials.length > 12) issues.push(`${rowLabel}: initials are required and must be 12 characters or fewer.`)
      if (!VALID_ROLES.has(bidRole)) issues.push(`${rowLabel}: bid_role must be CPC, GL, R-DEV, D-DEV, TMC, or DEV.`)
      if (areaCode === 'TMU' && !['TMC', 'DEV'].includes(bidRole)) issues.push(`${rowLabel}: TMU bidders must use TMC or DEV.`)
      if (areaCode !== 'TMU' && ['TMC', 'DEV'].includes(bidRole)) issues.push(`${rowLabel}: Areas A–F must use CPC, GL, R-DEV, or D-DEV.`)
      if (email && !EMAIL_PATTERN.test(email)) issues.push(`${rowLabel}: email is not valid.`)
      if (rawDate && !seniorityDate) issues.push(`${rowLabel}: seniority_date must be a valid date.`)

      const rankKey = `${areaCode}:${rank}`
      if (seenInitials.has(initials)) issues.push(`${rowLabel}: initials ${initials} appear more than once.`)
      if (profileId && seenProfileIds.has(profileId)) issues.push(`${rowLabel}: profile_id ${profileId} appears more than once.`)
      if (seenRanks.has(rankKey)) issues.push(`${rowLabel}: seniority rank ${rank} appears more than once in ${areaCode}.`)
      if (email && seenEmails.has(email)) issues.push(`${rowLabel}: email ${email} appears more than once.`)

      seenInitials.add(initials)
      if (profileId) seenProfileIds.add(profileId)
      seenRanks.add(rankKey)
      if (email) seenEmails.add(email)
      importedRows.push({
        sourceRow, sourceSheet: sheet.name, profile_id: profileId, area_code: areaCode,
        seniority_rank: rank, first_name: firstName, last_name: lastName, initials,
        email, phone, bid_role: bidRole as RosterImportRow['bid_role'], seniority_date: seniorityDate, active,
      })
    }
  }

  if (!importedRows.length) issues.push('No roster rows were found. Include seniority_rank and last_name in the header row.')
  if (importedRows.length > MAX_IMPORT_ROWS) issues.push(`The file contains ${importedRows.length} rows; the maximum is ${MAX_IMPORT_ROWS}.`)
  if (!importedRows.some((row) => row.profile_id)) warnings.push('No profile IDs were supplied. Existing bidders will be matched by initials.')
  if (issues.length) throw new RosterImportError(issues.slice(0, 100))

  return { fileName: file.name, rows: importedRows, warnings }
}
