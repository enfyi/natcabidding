import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('async function openMemberDashboard(');
const helper = source.slice(start, source.indexOf('\n}', start) + 2);
function setup() {
  const calls = [];
  const context = {
    supabaseState: { authUserId: 'member', authRestorePromise: null },
    currentUser: { supabaseProfileId: 'profile' },
    syncMemberPageUrl: page => calls.push(`url:${page}`),
    showLoggedInApp: page => calls.push(`member:${page}`),
    restoreSupabaseSession: async page => { calls.push(`restore:${page}`); return true; },
    showPublicHome: () => calls.push('public'),
    setAuthStatus: () => calls.push('error'),
  };
  vm.runInNewContext(helper, context);
  return { context, calls };
}
{
  const { context, calls } = setup();
  assert.equal(await context.openMemberDashboard(), true);
  assert.deepEqual(calls, ['url:dashboard', 'member:dashboard']);
}
{
  const { context, calls } = setup();
  let finish;
  context.supabaseState.authRestorePromise = new Promise(resolve => { finish = resolve; });
  const opening = context.openMemberDashboard();
  assert.deepEqual(calls, []);
  calls.push('public-startup-finished');
  finish(true);
  assert.equal(await opening, true);
  assert.deepEqual(calls, ['public-startup-finished', 'url:dashboard', 'member:dashboard']);
}
for (const reason of ['failed-startup', 'signed-out']) {
  const { context, calls } = setup();
  if (reason === 'failed-startup') context.supabaseState.authRestorePromise = Promise.resolve(false);
  else context.supabaseState.authUserId = '';
  assert.equal(await context.openMemberDashboard(), false);
  assert.deepEqual(calls, []);
}
{
  const { context, calls } = setup();
  context.currentUser = null;
  assert.equal(await context.openMemberDashboard(), true);
  assert.deepEqual(calls, ['url:dashboard', 'restore:dashboard']);
}
{
  const { context, calls } = setup();
  context.showLoggedInApp = () => { throw new Error('Render failed'); };
  assert.equal(await context.openMemberDashboard(), false);
  assert.deepEqual(calls, ['url:dashboard', 'public', 'error']);
}
assert.match(source, /runUiAction\("open-dashboard", publicLoginToggle, "Opening dashboard…", openMemberDashboard\)/);
console.log('PASS public Dashboard navigation, startup race, sign-out, missing profile, and render failure.');
