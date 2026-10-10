import type { ArchiveWebSheet } from '@/lib/previous-years'

function visibleCellStyle(style: ArchiveWebSheet['styles'][number] = {}) {
  const result = { ...style }
  for (const side of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const) {
    if (/\b(dotted|dashed)\b/.test(result[side] || '')) result[side] = 'none'
  }
  return result
}

export function ArchiveSheet({ sheet, month = 0, calendar = false }: { sheet: ArchiveWebSheet; month?: number; calendar?: boolean }) {
  const section = calendar ? sheet.months[month] : undefined
  const rows = section ? sheet.rows.filter((row) => row.number < sheet.months[0].start || (row.number >= section.start && row.number <= section.end)) : sheet.rows
  const rdoHeader = calendar ? undefined : rows.find((row) => row.cells.some((cell) => /^sun(day)?$/i.test(cell.value.trim())) && row.cells.some((cell) => /^sat(urday)?$/i.test(cell.value.trim())))
  const first = rdoHeader?.cells.find((cell) => /^sun(day)?$/i.test(cell.value.trim()))?.column
  const last = rdoHeader?.cells.find((cell) => /^aws$/i.test(cell.value.trim()))?.column ?? rdoHeader?.cells.find((cell) => /^sat(urday)?$/i.test(cell.value.trim()))?.column
  // Only row labels and values set widths; merged summaries wrap within that grid.
  const widths = rdoHeader ? sheet.widths.map(() => 28) : undefined
  if (widths) {
    for (const row of rows.filter((row) => row.number >= rdoHeader!.number)) {
      for (const cell of row.cells) {
        if ((cell.colSpan || 1) > 1) continue
        const size = sheet.styles[cell.style]?.fontSize || 13
        const length = Math.max(...cell.value.split('\n').map((line) => line.length))
        widths[cell.column] = Math.max(widths[cell.column], Math.ceil(length * size * 0.8 + 12))
      }
    }
    if (first !== undefined && last !== undefined) {
      const standard = Math.max(...widths.slice(first, last + 1))
      for (let column = first; column <= last; column++) widths[column] = standard
    }
  }
  const displayWidths = calendar ? sheet.widths : widths
  return <div className={`historical-sheet historical-sheet-no-grid${calendar ? ' historical-sheet-calendar' : ''}`} tabIndex={0} role="region" aria-label={`${sheet.name}${section ? ` · ${section.label}` : ''}. Scroll horizontally to see all columns.`}>
    <table style={displayWidths ? { tableLayout: 'fixed', width: displayWidths.reduce((sum, width) => sum + width, 0) } : undefined}>
      <caption className="sr-only">{sheet.name}{section ? ` · ${section.label}` : ''}</caption>
      <colgroup>{sheet.widths.map((_, index) => <col key={index} style={displayWidths ? { width: displayWidths[index] } : undefined} />)}</colgroup>
      <tbody>{rows.map((row) => <tr key={row.number} style={{ height: row.height }}>{row.cells.map((cell) => <td key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.colSpan} style={{ ...(calendar ? sheet.styles[cell.style] : visibleCellStyle(sheet.styles[cell.style])), ...(widths && (row.number < rdoHeader!.number || (cell.colSpan || 1) > 1) ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : {}) }}>{cell.value}</td>)}</tr>)}</tbody>
    </table>
  </div>
}
