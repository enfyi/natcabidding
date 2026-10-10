import type { ArchiveWebSheet } from '@/lib/previous-years'

export function ArchiveSheet({ sheet, month = 0, calendar = false }: { sheet: ArchiveWebSheet; month?: number; calendar?: boolean }) {
  const section = calendar ? sheet.months[month] : undefined
  const rows = section ? sheet.rows.filter((row) => row.number < sheet.months[0].start || (row.number >= section.start && row.number <= section.end)) : sheet.rows
  return <div className="historical-sheet" tabIndex={0} role="region" aria-label={`${sheet.name}${section ? ` · ${section.label}` : ''}. Scroll horizontally to see all columns.`}>
    <table style={{ width: sheet.widths.reduce((sum, width) => sum + width, 0) }}>
      <caption className="sr-only">{sheet.name}{section ? ` · ${section.label}` : ''}</caption>
      <colgroup>{sheet.widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <tbody>{rows.map((row) => <tr key={row.number} style={{ height: row.height }}>{row.cells.map((cell) => <td key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.colSpan} style={sheet.styles[cell.style] || {}}>{cell.value}</td>)}</tr>)}</tbody>
    </table>
  </div>
}
