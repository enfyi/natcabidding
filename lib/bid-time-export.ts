import JSZip from 'jszip'

export type BidTimeExportBidder = {
  profile_id: string; area_name: string; seniority_rank: number | null
  first_name: string; last_name: string; initials: string; bid_role: string
  leave_slot_allowance: number | null
}
export type BidTimeExportWindow = { bidder_id: string; round_number: number; opens_at: string }

function xml(value: unknown) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function buildBidTimeExport(bidders: BidTimeExportBidder[], windows: BidTimeExportWindow[], year: number) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const starts = new Map(windows.map(window => [`${window.bidder_id}:${window.round_number}`, window.opens_at]))
  const rounds = Math.max(6, ...windows.map(window => Number(window.round_number)).filter(round => Number.isInteger(round) && round <= 20))
  const rows: unknown[][] = [
    ['Bid year', 'Area', 'Rank', 'First name', 'Last name', 'Initials', 'Bidder type', 'Annual bid allocation (hours)', ...Array.from({ length: rounds }, (_, i) => `Round ${i + 1} start (Pacific)`)],
    ...bidders.map(bidder => [year, bidder.area_name, bidder.seniority_rank, bidder.first_name, bidder.last_name, bidder.initials, bidder.bid_role, bidder.leave_slot_allowance,
      ...Array.from({ length: rounds }, (_, i) => {
        const start = starts.get(`${bidder.profile_id}:${i + 1}`)
        return start ? formatter.format(new Date(start)) : ''
      })]),
  ]
  function column(index: number): string {
    return index < 26 ? String.fromCharCode(65 + index) : column(Math.floor(index / 26) - 1) + column(index % 26)
  }
  const end = `${column(rows[0].length - 1)}${rows.length}`
  const sheetData = rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => {
    const ref = `${column(j)}${i + 1}`
    return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"${i === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bid Times" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>')
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="3" width="12" customWidth="1"/><col min="4" max="5" width="22" customWidth="1"/><col min="6" max="7" width="12" customWidth="1"/><col min="8" max="${rows[0].length}" width="30" customWidth="1"/></cols><sheetData>${sheetData}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
