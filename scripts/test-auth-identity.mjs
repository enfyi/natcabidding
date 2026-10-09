import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const claimStart = source.indexOf('async function claimSupabaseProfile() {')
const claimEnd = source.indexOf('\nasync function canRequestSupabaseLoginEmail', claimStart)
function claim({ profileEmail = 'jonathan@example.com', sessionId = 'jonathan' } = {}) {
  return runInNewContext(`${source.slice(claimStart, claimEnd)}\nclaimSupabaseProfile`, {
    supabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'jonathan', email: 'jonathan@example.com' } } }),
        getSession: async () => ({ data: { session: { user: { id: sessionId } } } }),
      },
      rpc: async () => ({ data: [{ email: profileEmail, role: 'controller' }] }),
    }),
    normalizedEmail: (email) => String(email || '').trim().toLowerCase(),
    profileFromSupabase: (profile) => profile,
  })()
}
assert.equal((await claim()).role, 'controller')
await assert.rejects(claim({ profileEmail: 'michael@example.com' }), /does not match/)
await assert.rejects(claim({ sessionId: 'michael' }), /sign-in changed/)

const initStart = source.indexOf('async function initializeSupabaseAuth() {')
const initEnd = source.indexOf('\nasync function restoreSupabaseSession', initStart)
for (const serverAvailable of [true, false]) {
  const events = []
  const context = {
    URL,
    window: { location: { href: 'https://example.com/bidding/bidding.html?member=1&serverSession=1' } },
    supabaseState: { authInitialized: false },
    currentUser: { email: 'michael@example.com' },
    fetch: async (path, options) => {
      assert.equal(path, 'api/auth/session')
      assert.equal(options.cache, 'no-store')
      events.push('fetch')
      return { ok: serverAvailable, json: async () => ({ access_token: 'jonathan', refresh_token: 'refresh' }) }
    },
    supabaseClient: () => ({ auth: {
      setSession: async (session) => { assert.equal(session.access_token, 'jonathan'); events.push('replace'); return {} },
      signOut: async () => events.push('signout'),
      onAuthStateChange: () => events.push('subscribe'),
    } }),
    pendingSupabaseEmailToken: () => null,
    restoreSupabaseSession: async () => { events.push('restore'); return true },
    clearSupabaseAccountState: () => events.push('clear'),
    showPublicHome: () => events.push('home'),
    setAuthStatus: () => {},
  }
  const initialize = runInNewContext(`${source.slice(initStart, initEnd)}\ninitializeSupabaseAuth`, context)
  assert.equal(await initialize(), serverAvailable)
  assert.deepEqual(events, serverAvailable ? ['fetch', 'replace', 'subscribe', 'restore'] : ['fetch', 'signout', 'clear', 'home'])
  if (!serverAvailable) assert.equal(context.currentUser, null)
}
console.log('Auth identity checks passed: account handoff, mismatched profile, changed session, and expired server session.')
