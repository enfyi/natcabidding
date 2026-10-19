import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { buildBidTimeExport } from '../lib/bid-time-export.ts'

const bidders = [
  { profile_id: 'a', area_name: 'Area A', seniority_rank: 1, first_name: 'A & <B>', last_name: '=SUM(1)', initials: 'AB', bid_role: 'CPC', leave_slot_allowance: 208 },
  { profile_id: 'b', area_name: 'TMU', seniority_rank: 2, first_name: 'Test', last_name: 'Bidder', initials: 'TB', bid_role: 'TMC', leave_slot_allowance: 0 },
]
const zip = await JSZip.loadAsync(await buildBidTimeExport(bidders, [
  { bidder_id: 'a', round_number: 1, opens_at: '2026-10-05T16:00:00Z' },
  { bidder_id: 'b', round_number: 6, opens_at: '2026-12-05T17:00:00Z' },
], 2027))
const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string')
assert.match(sheet, /10\/05\/2026, 09:00/)
assert.match(sheet, /12\/05\/2026, 09:00/)
assert.match(sheet, /A &amp; &lt;B&gt;/)
assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=SUM\(1\)/)
assert.doesNotMatch(sheet, /<f>/)
assert.match(sheet, /Round 6 start \(Pacific\)/)
assert.match(sheet, /r="J2" t="inlineStr"><is><t xml:space="preserve"><\/t>/)
assert.match(sheet, /autoFilter ref="A1:N3"/)
assert.match(sheet, /Annual bid allocation \(hours\)/)
assert.match(sheet, /<c r="H2"><v>208<\/v><\/c>/)
assert.match(sheet, /<c r="H3"><v>0<\/v><\/c>/)
assert.match(await zip.file('xl/workbook.xml').async('string'), /name="Bid Times"/)
assert.match(sheet, /Bidder type/)
for (const bid_role of ['CPC', 'R-DEV', 'D-DEV', 'GL', 'TMC', 'DEV', 'TMCIT']) {
  const typedZip = await JSZip.loadAsync(await buildBidTimeExport([{ ...bidders[0], bid_role }], [], 2027))
  const typedSheet = await typedZip.file('xl/worksheets/sheet1.xml').async('string')
  assert.ok(typedSheet.includes(`<c r="G2" t="inlineStr"><is><t xml:space="preserve">${bid_role}</t></is></c>`), `${bid_role} must appear in the bidder type column`)
}
console.log('Bid-time workbook export passed: all rounds, Pacific DST, blanks, and safe text.')
