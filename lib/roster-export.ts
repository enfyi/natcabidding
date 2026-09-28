import JSZip from 'jszip'

export type SeniorityRosterExportRow = {
  profile_id: string
  area_code: string
  seniority_rank: number
  first_name: string
  last_name: string
  initials: string
  email: string | null
  phone: string | null
  bid_role: string
  seniority_date: string | null
  active: boolean
  leave_slot_allowance: number
}

const FIRST_DATA_ROW = 6
const LAST_TEMPLATE_ROW = 500
const MAX_EXPORT_ROWS = LAST_TEMPLATE_ROW - FIRST_DATA_ROW + 1
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function rowXml(xml: string, rowNumber: number) {
  const match = xml.match(new RegExp(`<((?:\\w+:)?row)\\b([^>]*\\br="${rowNumber}"[^>]*)>([\\s\\S]*?)<\\/\\1>`, 'i'))
  return match?.[0] || ''
}

function cellStyle(xml: string, column: string, rowNumber: number) {
  const reference = `${column}${rowNumber}`
  const match = xml.match(new RegExp(`<(?:\\w+:)?c\\b([^>]*\\br="${reference}"[^>]*)`, 'i'))
  return match?.[1].match(/\bs="([^"]+)"/i)?.[1] || ''
}

function excelDateSerial(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const serial = Math.round((timestamp - Date.UTC(1899, 11, 30)) / 86_400_000)
  return Number.isFinite(serial) ? serial : null
}

function cellXml(reference: string, style: string, value: unknown, numeric = false) {
  const styleAttribute = style ? ` s="${style}"` : ''
  if (value === null || value === undefined || value === '') return `<x:c r="${reference}"${styleAttribute} />`
  if (numeric) return `<x:c r="${reference}"${styleAttribute} t="n"><x:v>${escapeXml(value)}</x:v></x:c>`
  return `<x:c r="${reference}"${styleAttribute} t="inlineStr"><x:is><x:t>${escapeXml(value)}</x:t></x:is></x:c>`
}

function exportValues(row: SeniorityRosterExportRow) {
  return [
    row.profile_id,
    row.area_code,
    row.seniority_rank,
    row.first_name,
    row.last_name,
    row.initials,
    row.email || '',
    row.phone || '',
    row.bid_role,
    excelDateSerial(row.seniority_date),
    row.active ? 'Yes' : 'No',
    row.leave_slot_allowance,
  ]
}

function generatedRowXml(templateXml: string, rowNumber: number, values: unknown[] | null) {
  const styleRow = rowNumber <= LAST_TEMPLATE_ROW ? rowNumber : 9
  const cells = COLUMNS.map((column, index) => {
    const numeric = index === 2 || index === 9 || index === 11
    return cellXml(`${column}${rowNumber}`, cellStyle(templateXml, column, styleRow), values?.[index] ?? '', numeric)
  }).join('')
  return `<x:row r="${rowNumber}">${cells}</x:row>`
}

export async function buildSeniorityRosterExport(template: Uint8Array, rows: SeniorityRosterExportRow[]) {
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Error(`An area export can contain at most ${MAX_EXPORT_ROWS} roster rows.`)
  }

  const zip = await JSZip.loadAsync(template)
  const worksheetPath = 'xl/worksheets/sheet1.xml'
  const tablePath = 'xl/tables/table1.xml'
  const worksheet = await zip.file(worksheetPath)?.async('string')
  const table = await zip.file(tablePath)?.async('string')
  if (!worksheet || !table) throw new Error('The seniority roster template is missing its roster worksheet or table.')

  const fixedRows = [2, 3, 4, 5].map((rowNumber) => rowXml(worksheet, rowNumber)).join('')
  const lastDataRow = FIRST_DATA_ROW + rows.length - 1
  const finalRow = Math.max(LAST_TEMPLATE_ROW, lastDataRow)
  const generatedRows: string[] = []
  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= finalRow; rowNumber += 1) {
    const rosterRow = rows[rowNumber - FIRST_DATA_ROW]
    generatedRows.push(generatedRowXml(worksheet, rowNumber, rosterRow ? exportValues(rosterRow) : null))
  }

  const nextWorksheet = worksheet.replace(
    /<x:sheetData>[\s\S]*?<\/x:sheetData>/,
    `<x:sheetData>${fixedRows}${generatedRows.join('')}</x:sheetData>`,
  )
  const tableEndRow = Math.max(FIRST_DATA_ROW, lastDataRow)
  const nextTable = table.replace(/ref="A5:L\d+"/g, `ref="A5:L${tableEndRow}"`)

  zip.file(worksheetPath, nextWorksheet)
  zip.file(tablePath, nextTable)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
