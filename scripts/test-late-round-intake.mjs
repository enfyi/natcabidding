import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const fn = name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const c = vm.createContext({ currentUser: { role: 'controller' }, lateRoundEntryEnabled: false,
  lateRoundIntakeEnabled: false, hasSystemAdminAccess: () => false, openAreaBidRound: () => 4 });
vm.runInContext(['canEnterLateRoundLeave', 'manualLeaveRoundAllowed'].map(fn).join('\n'), c);
for (const enabled of [false, true]) for (const intake of [false, true]) {
  c.lateRoundEntryEnabled = enabled; c.lateRoundIntakeEnabled = intake;
  for (const role of ['admin', 'intake', 'controller']) {
    c.currentUser.role = role;
    for (const round of [5, 6]) assert.equal(c.manualLeaveRoundAllowed(round, 'Area A'),
      enabled && (role === 'admin' || (intake && role === 'intake')), `${role}, round ${round}, enabled ${enabled}, intake ${intake}`);
    assert.equal(c.manualLeaveRoundAllowed(4, 'Area A'), true);
    assert.equal(c.manualLeaveRoundAllowed(3, 'Area A'), false);
    assert.equal(c.manualLeaveRoundAllowed(7, 'Area A'), false);
  }
}
c.openAreaBidRound = () => 5;
c.lateRoundEntryEnabled = false;
assert.equal(c.manualLeaveRoundAllowed(5, 'Area A'), false, 'Scheduled round alone never authorizes late entry');
console.log('PASS late-round toggle/role matrix, both rounds, closed rounds, and scheduled-round bypass protection');
