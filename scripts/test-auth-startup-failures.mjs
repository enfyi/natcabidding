import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const profile = { supabaseProfileId: 'own-profile', systemAdmin: false };
function setup(overrides = {}) {
  const calls = [];
  const context = {
    currentUser: null,
    supabaseState: { authRestorePromise: null, authUserId: 'own-user' },
    requestedLandingPage: () => 'dashboard',
    measureDashboardStartupStep: async (_label, fn) => fn(),
    refreshSupabaseAccountState: async () => ({ user: { id: 'own-user' } }),
    claimSupabaseProfile: async () => profile,
    rejectUnmatchedSupabaseLogin: async () => calls.push('rejected'),
    loadSupabaseReferenceData: async () => {},
    requestedPublicView: () => false,
    showLoggedInApp: () => calls.push('member'),
    showPublicHome: () => calls.push('public'),
    setAuthStatus: () => {},
    recordReferenceLoadDiagnostic: () => {},
    document: { querySelector: () => ({ setAttribute: () => calls.push('hidden') }) },
    ...overrides,
  };
  vm.runInNewContext(extract('restoreSupabaseSession'), context);
  return { context, calls };
}
for (const failedStep of ['refreshSupabaseAccountState', 'claimSupabaseProfile', 'loadSupabaseReferenceData', 'showLoggedInApp']) {
  const { context, calls } = setup({ [failedStep]: () => { throw new Error('Load failed'); } });
  assert.equal(await context.restoreSupabaseSession(), false, failedStep);
  assert.equal(context.currentUser, null, failedStep);
  assert.ok(calls.includes('hidden'), failedStep);
  assert.ok(calls.includes('public'), failedStep);
  assert.equal(context.supabaseState.authRestorePromise, null, 'Failed startup can be retried');
}
{
  const { context, calls } = setup({ refreshSupabaseAccountState: async () => null });
  assert.equal(await context.restoreSupabaseSession(), false);
  assert.equal(context.currentUser, null);
  assert.deepEqual(calls, ['public']);
}
for (const delayedStep of ['claimSupabaseProfile', 'loadSupabaseReferenceData']) {
  let finish;
  const { context, calls } = setup({ [delayedStep]: () => new Promise(resolve => { finish = resolve; }) });
  const pending = context.restoreSupabaseSession();
  while (!finish) await Promise.resolve();
  context.currentUser = null;
  context.supabaseState.authUserId = '';
  finish(profile);
  assert.equal(await pending, false);
  assert.equal(context.currentUser, null);
  assert.ok(!calls.includes('member'), 'Late results must not reopen a signed-out dashboard');
}
{
  const { context, calls } = setup();
  assert.equal(await context.restoreSupabaseSession(), true);
  assert.equal(context.currentUser, profile);
  assert.deepEqual(calls, ['member']);
}
console.log('PASS failed session/profile/data/render, missing session, late results after sign-out, and successful startup.');
