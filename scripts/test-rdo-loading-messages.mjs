import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const functions = extract('function rdoLinesLoadMessage()', 'function updatePublicRdoResults()')
  + extract('function renderRdoLines()', 'function updateSelectedLine()')

for (const authUserId of ['', 'member-id']) {
  const table = { innerHTML: '' }
  const cards = { innerHTML: '' }
  const state = { authUserId, rdoLinesLoadState: 'idle', referenceDataLoaded: false }
  const context = vm.createContext({
    supabaseState: state,
    document: {
      getElementById: () => table,
      querySelector: selector => selector === '[data-member-rdo-cards]' ? cards : null,
    },
    escapeHtml: value => value,
    setText: () => {},
    currentViewArea: () => 'Area A',
    publicRdoFilteredLines: () => [],
    rdoLinesForArea: () => [],
    rdoLinesForBidder: () => [],
    currentUserBidAs: () => 'CPC',
    isViewingHomeArea: () => true,
    selectedLineId: '',
    rdoLineMatchesFilters: () => true,
    pendingCurrentUserRdoRequest: () => null,
    memberRdoPresentation: 'cards',
  })
  vm.runInContext(functions, context)
  for (const [loadState, finished, expected] of [
    ['idle', false, 'Loading RDO lines…'],
    ['loading', true, 'Loading RDO lines…'],
    ['error', true, 'RDO lines could not be loaded. Please refresh the browser to reload.'],
    ['idle', true, 'RDO lines could not be loaded. Please refresh the browser to reload.'],
    ['loaded', true, 'No RDO lines match those filters for Area A.'],
  ]) {
    state.rdoLinesLoadState = loadState
    state.referenceDataLoaded = finished
    assert.ok(context.publicRdoSectionsMarkup('Area A', []).includes(expected))
    assert.ok(context.publicRdoRowsMarkup('Area A', []).includes(expected))
    context.renderRdoLines()
    assert.ok(table.innerHTML.includes(expected))
    assert.ok(cards.innerHTML.includes(expected))
  }
  state.rdoLinesLoadState = 'error'
  const staleLines = [{ line: '1', pattern: 'OLD SCHEDULE' }]
  assert.doesNotMatch(context.publicRdoSectionsMarkup('Area A', staleLines), /OLD SCHEDULE/)
  assert.doesNotMatch(context.publicRdoRowsMarkup('Area A', staleLines), /OLD SCHEDULE/)
  console.log(`${authUserId ? 'Signed in' : 'Signed out'}: RDO loading, failure, and successful empty results verified in cards and tables.`)
}
