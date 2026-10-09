import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const extract = (name) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1))
const context = vm.createContext({
  fatigueGroupPreferenceLabel: (v) => v || 'No preference',
  rdoBidPreferenceLabel: (v) => v === true ? 'Yes' : v === false ? 'No' : v || 'Not selected',
  escapeHtml: (v) => String(v).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  formatDateTime: (v) => v.toISOString(),
})
vm.runInContext(['rdoBidSnapshotSummary', 'rdoBidChangeDifferences', 'renderIntakeAdminEditHistory', 'renderIntakeChangeHistory'].map(extract).join('\n'), context)
const first = { line: '24', fatigueGroup: 'A', flex: true, aws: false, mid: 'No' }
const second = { ...first, line: '25', flex: false }
const third = { ...second, fatigueGroup: 'B', aws: true }
context.item = { isChange: false, adminEditHistory: [
  { before: second, after: third, editedBy: '<AB>', editedAt: '2026-10-08T12:00:00Z' },
  { before: first, after: second, editedBy: 'CD', editedAt: '2026-10-07T12:00:00Z' },
  { before: third, after: third, editedBy: 'Leave only' },
] }
const markup = vm.runInContext('renderIntakeChangeHistory(item)', context)
assert.equal((markup.match(/<strong>Admin edit<\/strong>/g) || []).length, 2)
assert.match(markup, /Line: 24 → 25/)
assert.match(markup, /Flex: Yes → No/)
assert.match(markup, /Fatigue: A → B/)
assert.match(markup, /AWS: No → Yes/)
assert.match(markup, /Before:<\/b> Line 24/)
assert.match(markup, /After:<\/b> Line 25/)
assert.match(markup, /&lt;AB&gt; · 2026-10-08/)
assert.doesNotMatch(markup, /Leave only|<AB>/)
context.item = {}
assert.equal(vm.runInContext('renderIntakeChangeHistory(item)', context), '')
console.log('PASS every admin RDO edit displays before/after values, differences, actor and time; unchanged saves are omitted')
