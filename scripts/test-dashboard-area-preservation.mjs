import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};

for (const role of ['admin', 'intake']) {
  const entry = ['Area A', '', '', 'AB'];
  const person = { area: 'Area A', initials: 'AB', firstName: 'Updated', rank: 1 };
  const context = {
    currentUser: { supabaseProfileId: 'own-profile', initials: 'AB', area: 'Area A' },
    selectedViewArea: 'Area B', senioritySource: [], intakeTeamInitials: new Set(),
    bidderRowToSeniorityEntry: () => entry,
    seniorityEntryAppRole: () => role,
    seniorityEntryProfileId: () => 'own-profile',
    rosterEntryToPerson: () => person,
    buildSeniority: () => [],
    findRosterEntryByInitials: () => entry,
    seniorityEntryActive: () => true,
  };
  vm.createContext(context);
  vm.runInContext(['applyRosterFromDatabase', 'syncCurrentUserFromRoster', 'currentViewArea'].map(extract).join('\n'), context);
  for (let refresh = 0; refresh < 2; refresh++) {
    context.applyRosterFromDatabase([{}]);
    assert.equal(context.currentViewArea(), 'Area B', `${role} roster refresh preserves Area B`);
    assert.equal(context.currentUser.firstName, 'Updated');
  }
  person.area = 'Area C';
  context.syncCurrentUserFromRoster('AB', 'AB');
  assert.equal(context.currentUser.area, 'Area C', 'Own profile still updates');
  assert.equal(context.currentViewArea(), 'Area B', 'Own roster edit preserves selected area');
  context.selectedViewArea = null;
  context.applyRosterFromDatabase([{}]);
  assert.equal(context.currentViewArea(), 'Area C', 'No selection falls back to assigned area');
}
console.log('PASS admin and intake refreshes and roster edits preserve the selected dashboard area');
