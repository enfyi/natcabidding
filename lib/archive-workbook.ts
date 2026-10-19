import JSZip from 'jszip'
import { readSpreadsheetSheets } from './bid-line-import'
import { archiveFileError, type ArchivePreview } from './previous-years'
import { renderArchiveWorkbook } from './archive-web-workbook'

// Check expanded size before the existing spreadsheet reader materializes XML.
// Excel calendars use cached values; formulas are never executed by the importer.
export async function previewArchiveWorkbook(file: File): Promise<ArchivePreview> {
  const error = archiveFileError(file)
  if (error) throw new Error(error)
  const buffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const files = Object.values(zip.files).filter((entry) => !entry.dir)
  if (files.length > 1000) throw new Error('This workbook contains too many internal files.')
  if (zip.file('xl/vbaProject.bin')) throw new Error('Upload a workbook without macros.')
  let expandedBytes = 0
  for (const entry of files) {
    await new Promise<void>((resolve, reject) => {
      const stream = entry.nodeStream()
      stream.on('data', (chunk: Buffer) => {
        expandedBytes += chunk.length
        if (expandedBytes > 32 * 1024 * 1024) {
          stream.pause()
          reject(new Error('This workbook expands beyond the 32 MB import limit. Export a smaller workbook.'))
        }
      }).on('error', reject).on('end', resolve)
    })
  }
  const sheets = await readSpreadsheetSheets(new File([buffer], file.name))
  if (sheets.length > 30) throw new Error('Import up to 30 worksheet tabs per workbook.')
  if (!sheets.some((sheet) => sheet.rows.length)) throw new Error('The workbook has no populated worksheet tabs.')
  return {
    workbook: await renderArchiveWorkbook(zip),
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows.length,
      sample: sheet.rows.slice(0, 8).map((row) => Array.from({ length: Math.min(row.length, 14) }, (_, index) => String(row[index] || '').slice(0, 240))),
    })),
  }
}
