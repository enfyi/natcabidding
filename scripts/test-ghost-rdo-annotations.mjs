import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const line = { id: 'source', line: '1', area: 'Area A', status: 'Open', cpc: '' };
const context = vm.createContext({ rdoLines: [line], publicGhostRdoBids: [{ line: "1", area: "Area A", initials: "GX" }], uiStatusFromDatabase: s => s, escapeHtml: s => s, currentUser: { initials: 'AB' } });
for (const name of ['applyGlRdoAssignments', 'lineOccupant', 'lineGlBids', 'lineBidderMarkup', 'lineStatusMarkup']) {
 const start = source.indexOf(`function ${name}(`);
 vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
context.applyGlRdoAssignments([
 { rdo_line_id: 'source', initials: 'GX', ghost_bid: true, status: 'approved' },
 { rdo_line_id: 'source', initials: 'OC', ghost_bid: false, status: 'pending' },
 { rdo_line_id: 'source', initials: 'GX', ghost_bid: true, status: 'approved' },
]);
assert.equal(line.status, 'Open');
assert.equal(line.cpc, '');
assert.equal(line.glBids.length, 2);
const markup = context.lineBidderMarkup(line, { showOpenWhenShared: true });
assert.match(markup, /Open/);
assert.equal((markup.match(/\*GX/g) || []).length, 1);
assert.match(markup, /Ghost Bid · does not occupy this line">\*GX/);
assert.match(markup, /GL Bid · does not occupy this line">\*OC/);
line.status = 'Taken'; line.cpc = 'AB';
assert.match(context.lineBidderMarkup(line), /<span>AB<\/span>/);
assert.match(context.lineStatusMarkup(line), /\*GX/);
context.applyGlRdoAssignments([]);
assert.equal(line.glBids.length, 0);
console.log('PASS ghost and GL annotations coexist, preserve source availability, coexist with real occupants, deduplicate and clear on refresh');
