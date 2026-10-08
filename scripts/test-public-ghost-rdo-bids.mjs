import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function lineOccupant(');
const end = source.indexOf('\nfunction selectedMidValue(', start);
const context = vm.createContext({
  publicGhostRdoBids: [
    { line: '28', area: 'Area A', initials: 'OC' },
    { line: '28', area: 'Area A', initials: 'OC' },
    { line: '28', area: 'Area B', initials: 'OTHER' },
    { line: '29', area: 'Area A', initials: 'GJ' },
  ],
  currentUser: { initials: '' },
  escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
});
vm.runInContext(source.slice(start, end), context);
const open = { line: '28', area: 'Area A', status: 'Open', cpc: '' };
assert.match(context.lineOccupant(open), /^Open · .*\*OC/);
assert.equal(context.lineOccupant(open).match(/\*OC/g).length, 1);
assert.doesNotMatch(context.lineOccupant(open), /OTHER|GJ/);
assert.equal(open.status, 'Open');
assert.match(context.lineOccupant({ ...open, status: 'Taken', cpc: 'AA' }), /^AA · .*\*OC/);
assert.equal(context.lineOccupant({ ...open, line: '30' }), '');
context.publicGhostRdoBids = [];
assert.equal(context.lineOccupant(open), '');
assert.equal(context.lineOccupant({ ...open, status: 'Taken', cpc: 'AA' }), 'AA');
assert.match(source, /client\.rpc\("read_public_ghost_rdo_bids",/);
console.log('PASS public ghost labels show initials, stay in their area, and leave source lines open.');
