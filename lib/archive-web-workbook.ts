import type JSZip from 'jszip'
import type { ArchiveCellStyle, ArchiveWebWorkbook, ArchiveWebSheet } from './previous-years'

const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
  const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
  if (known[entity]) return known[entity]
  const value = entity.startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10)
  return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
})
const attr = (tag: string, key: string) => decode(tag.match(new RegExp(`(?:^|\\s)${key}=["']([^"']*)["']`))?.[1] || '')
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'))].map((match) => match[0])
const inner = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] || ''
const plain = (xml: string) => blocks(xml, 't').map((part) => decode(inner(part, 't'))).join('')
const position = (ref: string) => {
  const match = ref.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error('The workbook contains an invalid cell reference.')
  let column = 0
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64
  return { column: column - 1, row: Number(match[2]) }
}
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function dateValue(value: string, format: string, date1904: boolean) {
  if (!value) return ''
  const numeric = Number(value)
  const withoutLiterals = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
  if (!Number.isFinite(numeric) || !/[yd]|h.*m|m.*h/i.test(withoutLiterals)) return /^-?\d+\.0+$/.test(value) ? String(numeric) : value
  const date = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.round(numeric * 86400000))
  if (!Number.isFinite(date.getTime())) return value
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const minutes = /h/i.test(withoutLiterals)
  return format.split(';')[0].replace(/"([^"]*)"|\\(.)|\[[^\]]*\]|yyyy|yy|dddd|ddd|dd|d|mmmm|mmm|mm|m|hh|h|ss|s/gi, (token, quoted, escaped) => {
    if (quoted !== undefined) return quoted
    if (escaped !== undefined) return escaped
    const values: Record<string, string> = {
      yyyy: String(date.getUTCFullYear()), yy: String(date.getUTCFullYear()).slice(-2),
      dddd: weekdays[date.getUTCDay()], ddd: weekdays[date.getUTCDay()].slice(0, 3), d: String(date.getUTCDate()), dd: String(date.getUTCDate()).padStart(2, '0'),
      mmmm: monthNames[date.getUTCMonth()], mmm: monthNames[date.getUTCMonth()].slice(0, 3),
      m: String(minutes ? date.getUTCMinutes() : date.getUTCMonth() + 1), mm: String(minutes ? date.getUTCMinutes() : date.getUTCMonth() + 1).padStart(2, '0'),
      h: String(date.getUTCHours()), hh: String(date.getUTCHours()).padStart(2, '0'), s: String(date.getUTCSeconds()), ss: String(date.getUTCSeconds()).padStart(2, '0'),
    }
    return values[token.toLowerCase()] || ''
  })
}

// Runs only in the authenticated import API. The public page receives saved text and styles.
export async function renderArchiveWorkbook(zip: JSZip): Promise<ArchiveWebWorkbook> {
  const xml = async (path: string) => await zip.file(path)?.async('string') || ''
  const [workbook, relationships, sharedXml, styleXml, themeXml] = await Promise.all([
    xml('xl/workbook.xml'), xml('xl/_rels/workbook.xml.rels'), xml('xl/sharedStrings.xml'), xml('xl/styles.xml'), xml('xl/theme/theme1.xml'),
  ])
  const shared = blocks(sharedXml, 'si').map(plain)
  const theme = ['FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646']
  for (const [index, tag] of ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].entries()) {
    const part = themeXml.match(new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`))?.[1] || ''
    const found = attr(part.match(/<a:(?:srgbClr|sysClr)\b[^>]*\/>/)?.[0] || '', part.includes('sysClr') ? 'lastClr' : 'val')
    if (/^[\da-f]{6}$/i.test(found)) theme[index] = found
  }
  const color = (tag: string) => {
    let hex = attr(tag, 'rgb').slice(-6)
    if (!hex && attr(tag, 'theme')) hex = theme[Number(attr(tag, 'theme'))] || ''
    if (!hex && attr(tag, 'indexed')) hex = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF'][Number(attr(tag, 'indexed')) % 8] || ''
    if (!/^[\da-f]{6}$/i.test(hex)) return undefined
    const tint = Number(attr(tag, 'tint')) || 0
    if (tint) hex = hex.match(/../g)!.map((part) => { const n = parseInt(part, 16); return Math.round(Math.max(0, Math.min(255, tint < 0 ? n * (1 + tint) : n + (255 - n) * tint))).toString(16).padStart(2, '0') }).join('')
    return `#${hex}`
  }
  const fonts = blocks(inner(styleXml, 'fonts'), 'font')
  const fills = blocks(inner(styleXml, 'fills'), 'fill')
  const borders = blocks(inner(styleXml, 'borders'), 'border')
  const formats = new Map<number, string>([[14, 'mm/dd/yyyy'], [15, 'd-mmm-yy'], [16, 'd-mmm'], [17, 'mmm-yy'], [20, 'h:mm'], [21, 'h:mm:ss'], [22, 'mm/dd/yyyy h:mm']])
  for (const part of blocks(inner(styleXml, 'numFmts'), 'numFmt')) formats.set(Number(attr(part, 'numFmtId')), attr(part, 'formatCode'))
  const xfs = blocks(inner(styleXml, 'cellXfs'), 'xf')
  const styles: ArchiveCellStyle[] = (xfs.length ? xfs : ['']).map((xf) => {
    const font = fonts[Number(attr(xf, 'fontId'))] || ''
    const fill = fills[Number(attr(xf, 'fillId'))] || ''
    const border = borders[Number(attr(xf, 'borderId'))] || ''
    const align = blocks(xf, 'alignment')[0] || ''
    const style: ArchiveCellStyle = {
      color: color(blocks(font, 'color')[0] || ''),
      backgroundColor: /patternType="solid"/.test(fill) ? color(blocks(fill, 'fgColor')[0] || '') : undefined,
      fontSize: Math.max(10, Math.min(40, Number(attr(blocks(font, 'sz')[0] || '', 'val')) * 4 / 3 || 13)),
      fontWeight: /<b(?:\s[^>]*)?\s*\/>/.test(font) ? 700 : undefined,
      fontStyle: /<i(?:\s[^>]*)?\s*\/>/.test(font) ? 'italic' : undefined,
    }
    const horizontal = attr(align, 'horizontal')
    if (['left', 'center', 'right'].includes(horizontal)) style.textAlign = horizontal as ArchiveCellStyle['textAlign']
    const vertical = attr(align, 'vertical')
    if (['top', 'center', 'bottom'].includes(vertical)) style.verticalAlign = vertical === 'center' ? 'middle' : vertical as ArchiveCellStyle['verticalAlign']
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const part = blocks(border, side)[0] || ''
      const borderStyle = attr(part, 'style')
      if (borderStyle) style[`border${side[0].toUpperCase()}${side.slice(1)}` as 'borderTop'] = `${/medium|thick/.test(borderStyle) ? 2 : 1}px ${/dash|dot/i.test(borderStyle) ? 'dashed' : 'solid'} ${color(blocks(part, 'color')[0] || '') || '#555555'}`
    }
    return style
  })
  const differentialStyles = blocks(inner(styleXml, 'dxfs'), 'dxf').map((dxf) => {
    const style: ArchiveCellStyle = {}
    const foreground = color(blocks(inner(dxf, 'font'), 'color')[0] || '')
    const background = color(blocks(inner(dxf, 'fill'), 'fgColor')[0] || '')
    if (foreground) style.color = foreground
    if (background) style.backgroundColor = background
    return style
  })
  const targets = new Map(blocks(relationships, 'Relationship').map((part) => [attr(part, 'Id'), attr(part, 'Target')]))
  const sheets: ArchiveWebSheet[] = []
  for (const sheetTag of blocks(inner(workbook, 'sheets'), 'sheet')) {
    if (attr(sheetTag, 'state') === 'hidden' || attr(sheetTag, 'state') === 'veryHidden') continue
    const target = targets.get(attr(sheetTag, 'r:id')) || ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const sheetXml = await xml(path)
    const hidden = new Set<number>(); const widths = new Map<number, number>()
    for (const col of blocks(inner(sheetXml, 'cols'), 'col')) {
      const min = Number(attr(col, 'min')); const max = Number(attr(col, 'max'))
      for (let c = min - 1; c < Math.min(max, 128); c++) {
        if (attr(col, 'hidden') === '1') hidden.add(c)
        widths.set(c, Math.max(8, Math.min(280, (Number(attr(col, 'width')) || 12) * 7 + 5)))
      }
    }
    const allRows = blocks(inner(sheetXml, 'sheetData'), 'row')
    const hiddenRows = new Set(allRows.filter((row) => attr(row, 'hidden') === '1').map((row) => Number(attr(row, 'r'))))
    const rawRows = allRows.filter((row) => attr(row, 'hidden') !== '1')
    // Evaluate only simple text rules against cached text, never Excel formulas.
    const rules = blocks(sheetXml, 'conditionalFormatting').flatMap((part) => {
      const ranges = attr(part, 'sqref').split(/\s+/).map((ref) => {
        const [start, end] = ref.replace(/\$/g, '').split(':')
        return { start: position(start), end: position(end || start) }
      })
      return blocks(part, 'cfRule').map((rule) => ({
        ranges, type: attr(rule, 'type'), operator: attr(rule, 'operator'),
        text: attr(rule, 'text'), literal: decode(inner(rule, 'formula')).match(/^"([\s\S]*)"$/)?.[1],
        priority: Number(attr(rule, 'priority')), style: differentialStyles[Number(attr(rule, 'dxfId'))],
      }))
    }).sort((a, b) => b.priority - a.priority)
    const sheetStyles = styles.map((style) => ({ ...style }))
    const combinedStyles = new Map<string, number>()

    const cells = new Map<string, { value: string; style: number }>()
    let lastRow = 0; let lastCol = 0
    for (const row of rawRows) for (const cell of blocks(row, 'c')) {
      const ref = attr(cell, 'r'); const pos = position(ref)
      if (hidden.has(pos.column)) continue
      const style = Number(attr(cell, 's')) || 0
      const type = attr(cell, 't'); const value = decode(inner(cell, 'v'))
      const displayed = type === 's' ? shared[Number(value)] || '' : type === 'inlineStr' ? plain(cell) : type === 'b' ? value === '1' ? 'TRUE' : 'FALSE' : dateValue(value, formats.get(Number(attr(xfs[style] || '', 'numFmtId'))) || '', /date1904="1"/.test(workbook))
      let webStyle = style
      let combined = sheetStyles[style] || {}
      for (const rule of rules) {
        if (!rule.style || !rule.ranges.some((range) => pos.row >= range.start.row && pos.row <= range.end.row && pos.column >= range.start.column && pos.column <= range.end.column)) continue
        const matches = rule.type === 'containsText' && rule.text ? displayed.toLowerCase().includes(rule.text.toLowerCase())
          : rule.type === 'cellIs' && rule.operator === 'equal' && rule.literal !== undefined ? displayed.toLowerCase() === rule.literal.toLowerCase() : false
        if (matches) combined = { ...combined, ...rule.style }
      }
      if (combined !== sheetStyles[style]) {
        const key = JSON.stringify(combined)
        const existing = combinedStyles.get(key)
        if (existing !== undefined) webStyle = existing
        else { webStyle = sheetStyles.length; sheetStyles.push(combined); combinedStyles.set(key, webStyle) }
      }
      cells.set(`${pos.row}:${pos.column}`, { value: displayed.slice(0, 2000), style: webStyle })
      if (displayed) { lastRow = Math.max(lastRow, pos.row); lastCol = Math.max(lastCol, pos.column) }
    }
    if (!lastRow) continue
    const merges = blocks(inner(sheetXml, 'mergeCells'), 'mergeCell').map((part) => {
      const [a, b] = attr(part, 'ref').split(':'); return { start: position(a), end: position(b || a) }
    }).filter((merge) => merge.start.row <= lastRow && merge.start.column <= lastCol)
    for (const merge of merges) { lastRow = Math.max(lastRow, merge.end.row); lastCol = Math.max(lastCol, merge.end.column) }
    if (lastRow > 2000 || lastCol >= 128 || lastRow * (lastCol + 1) > 50000) throw new Error('The workbook is too large for a read-only web page. Split it into smaller worksheet tabs.')
    const visibleCols = Array.from({ length: lastCol + 1 }, (_, i) => i).filter((i) => !hidden.has(i))
    const visibleRows = new Map(rawRows.map((row) => [Number(attr(row, 'r')), row]))
    const rows: ArchiveWebSheet['rows'] = []
    for (let r = 1; r <= lastRow; r++) {
      // Missing rows are blank, while explicitly hidden rows stay excluded.
      if (hiddenRows.has(r)) continue
      const rowCells: ArchiveWebSheet['rows'][number]['cells'] = []
      for (const c of visibleCols) {
        const merge = merges.find((m) => r >= m.start.row && r <= m.end.row && c >= m.start.column && c <= m.end.column)
        if (merge && (r !== merge.start.row || c !== merge.start.column)) continue
        const cell = cells.get(`${r}:${c}`) || { value: '', style: 0 }
        rowCells.push({ column: visibleCols.indexOf(c), ...cell,
          ...(merge ? { rowSpan: merge.end.row - merge.start.row + 1 - [...hiddenRows].filter((n) => n >= merge.start.row && n <= merge.end.row).length, colSpan: visibleCols.filter((n) => n >= merge.start.column && n <= merge.end.column).length } : {}),
        })
      }
      rows.push({ number: r, height: Math.max(20, Math.min(100, Number(attr(visibleRows.get(r) || '', 'ht')) * 4 / 3 || 24)), cells: rowCells })
    }
    const monthRows = rows.filter((row) => row.cells.some((cell) => new RegExp(`^(?:${monthNames.join('|')})(?:\\s+20\\d{2})?$`, 'i').test(cell.value.trim())))
    const months = monthRows.map((row, index) => ({ label: row.cells.find((cell) => new RegExp(`^(?:${monthNames.join('|')})(?:\\s+20\\d{2})?$`, 'i').test(cell.value.trim()))!.value, start: row.number, end: (monthRows[index + 1]?.number || lastRow + 1) - 1 }))
    sheets.push({ name: attr(sheetTag, 'name'), widths: visibleCols.map((c) => widths.get(c) || 89), styles: sheetStyles, rows, months })
  }
  const result: ArchiveWebWorkbook = { version: 1, sheets }
  if (!sheets.length) throw new Error('The workbook has no visible populated worksheet tabs.')
  if (JSON.stringify(result).length > 1500000) throw new Error('The workbook web preview exceeds the import limit. Split it into smaller files.')
  return result
}
