import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'

const output = await mkdtemp(join(tmpdir(), 'zla-archive-test-'))
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--module', 'commonjs', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck', '--outDir', output, 'lib/archive-layout.ts', 'lib/archive-workbook.ts', 'lib/previous-years.ts', 'lib/bid-line-import.ts', 'lib/bid-line-import-types.ts'])
  await symlink(resolve('node_modules'), join(output, 'node_modules'))
  const require = createRequire(join(output, 'test.cjs'))
  const { previewArchiveWorkbook } = require('./archive-workbook.js')
  const { archiveLayoutForAgent, selectArchiveVariant } = require('./archive-layout.js')
  assert.equal(archiveLayoutForAgent('Mozilla/5.0 (iPhone)'), 'mobile')
  assert.equal(archiveLayoutForAgent('Mozilla/5.0 Android Mobile'), 'mobile')
  assert.equal(archiveLayoutForAgent('Mozilla/5.0 (Macintosh)'), 'desktop')
  assert.equal(archiveLayoutForAgent('iPhone', 'desktop'), 'desktop')
  assert.equal(archiveLayoutForAgent('Macintosh', 'mobile'), 'mobile')
  const versions = [{ layout: 'desktop', id: 'large' }, { layout: 'mobile', id: 'small' }]
  assert.equal(selectArchiveVariant(versions, 'mobile').id, 'small')
  assert.equal(selectArchiveVariant(versions.slice(0, 1), 'mobile').id, 'large')
  assert.equal(selectArchiveVariant(versions.slice(1), 'desktop').id, 'small')
  assert.equal(selectArchiveVariant([], 'mobile'), undefined)
  const { archiveFileError, archiveYearIsValid, ARCHIVE_MAX_BYTES } = require('./previous-years.js')

  assert.equal(archiveYearIsValid(2026), true)
  assert.equal(archiveYearIsValid(2026.5), false)
  assert.equal(archiveYearIsValid(1999), false)
  assert.match(archiveFileError({ name: 'old.xls', size: 100 }), /xlsx/)
  assert.match(archiveFileError({ name: 'empty.xlsx', size: 0 }), /empty/)
  assert.match(archiveFileError({ name: 'large.xlsx', size: ARCHIVE_MAX_BYTES + 1 }), /smaller/)
  await assert.rejects(() => previewArchiveWorkbook(new File(['not an Excel file'], 'bad.xlsx')))

  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="RDO &amp; History" r:id="r1"/><sheet name="Leave Calendar" r:id="r2"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
  zip.file('xl/sharedStrings.xml', '<sst><si><t>CE</t></si><si><t>&lt;script&gt;untrusted&lt;/script&gt;</t></si></sst>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c><c r="D1" t="inlineStr"><is><t>RDO</t></is></c></row></sheetData></worksheet>')
  zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')
  const workbook = new File([await zip.generateAsync({ type: 'uint8array' })], 'history.xlsx')
  const preview = await previewArchiveWorkbook(workbook)
  assert.equal(preview.workbook.version, 1)
  assert.equal(preview.workbook.sheets[0].rows[0].cells[1].value, 'CE')
  assert.equal(preview.workbook.sheets[1].rows[0].cells[1].value, '2')
  assert.equal(preview.sheets.length, 2)
  assert.equal(preview.sheets[0].name, 'RDO & History')
  assert.deepEqual(preview.sheets[0].sample[0], ['', 'CE', '', 'RDO'])
  assert.equal(preview.sheets[1].sample[0][1], '2', 'formulas must use cached values without executing')
  assert.equal(preview.sheets[1].sample[0][0], '<script>untrusted</script>', 'untrusted cell text remains plain text for React escaping')

  zip.file('xl/vbaProject.bin', 'macro')
  const macroFile = new File([await zip.generateAsync({ type: 'uint8array' })], 'macro.xlsx')
  await assert.rejects(() => previewArchiveWorkbook(macroFile), /without macros/)
  zip.remove('xl/vbaProject.bin')
  zip.file('oversized.xml', 'x'.repeat(33 * 1024 * 1024))
  const expandedFile = new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'expanded.xlsx')
  await assert.rejects(() => previewArchiveWorkbook(expandedFile), /32 MB/)

  // Optional supplied workbooks exercise the real Google Sheets export layouts.
  for (const path of process.argv.slice(2)) {
    const preview = await previewArchiveWorkbook(new File([await readFile(path)], path.split('/').pop()))
    if (process.env.ARCHIVE_FIXTURE_DIR) await writeFile(join(process.env.ARCHIVE_FIXTURE_DIR, path.split('/').pop() + '.json'), JSON.stringify(preview.workbook))
    if (path.endsWith('A.Cal.26.xlsx')) {
      const sheet = preview.workbook.sheets[0]
      assert.equal(sheet.widths.length, 8, 'hidden calendar columns are excluded')
      assert.ok(sheet.months.length >= 12, 'calendar is divided into months')
      assert.ok(sheet.rows.some(row => row.cells.some(cell => /Sun, Jan 11/.test(cell.value))), 'cached Excel dates are readable')
      assert.ok(sheet.rows.some(row => row.cells.some(cell => cell.colSpan === 7)), 'merged month headings are preserved')
      assert.equal(sheet.rows[0].cells.find(cell => cell.column === 1)?.value, 'CPC Slot', 'blank self-closing cells must not consume neighboring cells')
      assert.ok(!sheet.rows[4].cells.some(cell => /Dec 30/.test(cell.value)), 'blank formatted date cells remain blank')
      assert.ok(sheet.styles.some(style => style.backgroundColor), 'spreadsheet fills are preserved')
      console.log('Calendar sections:', sheet.months.map(month => month.label).join(', '))
    }
    if (path.endsWith('A.Cal.26M.xlsx')) {
      const sheet = preview.workbook.sheets[0]
      assert.equal(sheet.widths.length, 8)
      assert.ok(sheet.widths.reduce((a,b) => a+b,0) < 360, 'mobile calendar keeps its narrow source column widths')
      assert.ok(sheet.months.length >= 12)
      assert.ok(sheet.rows.some(row => row.cells.some(cell => cell.value === '1/11')), 'mobile dates retain their compact source format')
    }
    if (path.endsWith('A.RDO.26M.xlsx')) {
      const sheet = preview.workbook.sheets[0]
      assert.ok(sheet.widths.reduce((a,b) => a+b,0) < 650, 'mobile RDO is narrower than the desktop export')
      assert.ok(sheet.rows.some(row => row.cells.some(cell => cell.value === 'CE')))
    }
    if (path.endsWith('A.RDO.26.xlsx')) {
      const sheet = preview.workbook.sheets[0]
      const mid = sheet.rows[6].cells.find(cell => cell.column === 10)
      assert.equal(mid.value, 'BID')
      assert.equal(sheet.styles[mid.style].backgroundColor, '#B7E1CD', 'simple conditional formatting is resolved once during import')
    }
    console.log(`${path.split('/').pop()}: ${preview.sheets.map((sheet) => `${sheet.name} (${sheet.rows} populated rows)`).join(', ')}`)
  }
  console.log('Previous Years workbook validation passed.')
} finally { await rm(output, { recursive: true, force: true }) }
