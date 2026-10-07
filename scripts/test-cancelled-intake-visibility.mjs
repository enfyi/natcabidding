import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const extract = (name) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1))
const context = vm.createContext({
  intakeSearchQuery: '',
  intakeFilters: { status: 'Cancelled', type: 'all', area: 'all', round: 'all' },
  bidTypeLabel: (item) => item.type,
  intakeItemRound: (item) => item.round || 1,
  rdoBidSnapshotSummary: () => '',
})
vm.runInContext(['intakeDisplayStatus', 'intakeCancellationNote', 'intakeSearchText', 'intakeItemMatchesFilters'].map(extract).join('\n'), context)
for (const type of ['RDO Line', 'Leave']) {
  for (const status of ['Expired', 'Cancelled']) {
    const item = { type, status, initials: 'AB', area: 'Area A' }
    context.item = item
    assert.equal(vm.runInContext('intakeItemMatchesFilters(item)', context), true)
    context.intakeSearchQuery = 'cancelled'
    assert.equal(vm.runInContext('intakeItemMatchesFilters(item)', context), true)
    const note = vm.runInContext('intakeCancellationNote(item)', context)
    assert.match(note, type === 'RDO Line' ? /no longer assigns an RDO line/ : /no longer hold leave slots/)
    assert.equal(item.status, status, 'Stored history is preserved')
    context.intakeSearchQuery = ''
  }
}
for (const status of ['Approved', 'Pending', 'Denied']) {
  context.item = { type: 'RDO Line', status }
  assert.equal(vm.runInContext('intakeItemMatchesFilters(item)', context), false)
  assert.equal(vm.runInContext('intakeDisplayStatus(item)', context), status)
}
context.intakeFilters.status = 'all'
assert.equal(vm.runInContext('intakeItemMatchesFilters(item)', context), true)
console.log('PASS removed RDO bids and leave dates are visible and searchable as Cancelled in intake')
