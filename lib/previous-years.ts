export const ARCHIVE_BUCKET = 'previous-year-documents'
export const ARCHIVE_MAX_BYTES = 4 * 1024 * 1024
export const ARCHIVE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const ARCHIVE_KINDS = {
  rdo: 'RDO Lines',
  leave: 'Leave Calendar',
  bid_times: 'Bid Times',
} as const

export type ArchiveKind = keyof typeof ARCHIVE_KINDS
export type ArchiveLayout = 'desktop' | 'mobile'
export type ArchiveDocument = {
  id: string
  archive_year: number
  area_id: string
  document_kind: ArchiveKind
  layout: ArchiveLayout
  file_path: string
  file_name: string
  file_size: number
  sheet_names: string[]
  published: boolean
  updated_at: string
}
export type ArchivePreview = {
  sheets: { name: string; rows: number; sample: string[][] }[]
  workbook: ArchiveWebWorkbook
}

export type ArchiveCellStyle = {
  backgroundColor?: string; color?: string; fontSize?: number; fontWeight?: number
  fontStyle?: 'italic'; textAlign?: 'left' | 'center' | 'right'; verticalAlign?: 'top' | 'middle' | 'bottom'
  borderTop?: string; borderRight?: string; borderBottom?: string; borderLeft?: string
}
export type ArchiveWebWorkbook = { version: 1; sheets: ArchiveWebSheet[] }
export type ArchiveWebSheet = {
  name: string; widths: number[]; styles: ArchiveCellStyle[]
  rows: { number: number; height: number; cells: { column: number; value: string; style: number; rowSpan?: number; colSpan?: number }[] }[]
  months: { label: string; start: number; end: number }[]
}

export function archiveYearIsValid(value: number) {
  return Number.isInteger(value) && value >= 2000 && value <= 2100
}

export function archiveFileError(file: { name: string; size: number }) {
  if (!/\.xlsx$/i.test(file.name)) return 'Choose an Excel .xlsx file. Export older .xls files as .xlsx first.'
  if (!file.size) return 'The workbook is empty.'
  if (file.size > ARCHIVE_MAX_BYTES) return 'Choose a workbook that is 4 MB or smaller.'
  if (file.name.length > 240) return 'Shorten the filename to 240 characters or fewer.'
  return ''
}
