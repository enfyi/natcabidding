import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const rows = { innerHTML: '' };
const cards = { innerHTML: '' };
const context = vm.createContext({
  document: {
    getElementById: () => rows,
    querySelector: (selector) => selector === '[data-member-rdo-cards]' ? cards : null,
  },
  selectedLineId: '', selectedFatigueGroup: '', memberRdoPresentation: 'cards',
  currentViewArea: () => 'Area A', isViewingHomeArea: () => false,
  setText: () => {}, pendingCurrentUserRdoRequest: () => null,
  rdoLineMatchesFilters: () => true, isCurrentUserRdoLine: () => false,
  thirdDaySwingIndex: () => -1, shiftCell: (value) => value,
  lineOccupant: (line) => line.cpc, groupClass: (group) => group.toLowerCase(),
  escapeHtml: (value) => value, bidAsClass: (value) => value, dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
});
for (const name of ['userChoiceCell', 'lineMidReferenceValue', 'rdoLineAwsReferenceCell', 'rdoLineMidReferenceCell', 'rdoLineDisplayFatigueGroup', 'rdoFatigueGroupBadge', 'publicRdoRowsMarkup', 'publicRdoLineSection', 'publicRdoSectionsMarkup', 'renderRdoLines']) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
vm.runInContext('const PUBLIC_RDO_LINE_SECTIONS = ["CPC", "R-Dev", "D-Dev"];', context);
for (const aws of ['Yes', 'No']) {
  for (const mid of ['Yes', 'No', 'BID']) {
    const line = { line: '1', cpc: 'AB', pattern: 'S/S', status: 'Taken', group: 'A', aws, mid, week: Array(7).fill('RDO') };
    const midCell = mid === 'BID' ? '<span class="status open">Bid Line</span>' : mid;
    assert.ok(context.publicRdoRowsMarkup('Area A', [line]).includes(`<td>${aws}</td>\n        <td>${midCell}</td>`));
    const publicCards = context.publicRdoSectionsMarkup('Area A', [line]);
    assert.ok(publicCards.includes(`<p>AWS: ${aws}</p>`));
    assert.ok(publicCards.includes(`<p>Mid: ${midCell}</p>`));
    context.rdoLinesForArea = () => [line];
    context.renderRdoLines();
    assert.ok(rows.innerHTML.includes(`<td>${aws}</td>\n        <td>${midCell}</td>`));
    assert.ok(cards.innerHTML.includes(`<span>AWS: ${aws}</span>`));
    assert.ok(cards.innerHTML.includes(`<span>Mid: ${midCell}</span>`));
  }
}
for (const status of ['Open', 'Selected']) {
  assert.equal(context.rdoLineAwsReferenceCell({status, aws: 'Yes'}), '');
  assert.equal(context.rdoLineMidReferenceCell({status, mid: 'Yes'}), '');
  assert.match(context.rdoLineMidReferenceCell({status, mid: 'BID'}), /Bid Line/);
}
assert.equal(context.rdoLineAwsReferenceCell({status: 'Taken', aws: ''}), '');
assert.equal(context.rdoLineMidReferenceCell({status: 'Taken', mid: ''}), '');
console.log('PASS approved AWS/Mid choices in public and member tables and mobile cards; open lines and missing choices stay blank');
