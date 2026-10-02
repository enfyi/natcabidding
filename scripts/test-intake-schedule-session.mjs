import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const start = source.indexOf('async function ensureIntakeScheduleSession(client) {')
const end = source.indexOf('\nfunction setIntakeScheduleMutationPending(', start)
assert.ok(start >= 0 && end > start)

function guardWithState() {
  const events = []
  const context = {
    currentUser: { initials: 'OC' },
    clearSupabaseAccountState: () => events.push('clear'),
    showPublicHome: () => events.push('home'),
    setAuthStatus: (message) => events.push(message),
    setScheduleFormStatus: (message) => events.push(message),
    syncSupabaseAccountStateFromSession: (session) => events.push(session.user.id),
  }
  const guard = runInNewContext(`${source.slice(start, end)}\nensureIntakeScheduleSession`, context)
  return { guard, context, events }
}

{
  const { guard, context, events } = guardWithState()
  const allowed = await guard({ auth: { getSession: async () => ({ data: { session: null }, error: null }) } })
  assert.equal(allowed, false)
  assert.equal(context.currentUser, null)
  assert.ok(events.includes('home'))
  assert.ok(events.some((event) => event.includes('Sign in again')))
}

{
  const { guard, events } = guardWithState()
  const allowed = await guard({ auth: {
    getSession: async () => ({ data: { session: { user: { id: 'signed-in' } } }, error: null }),
    getUser: async () => ({ data: { user: { id: 'signed-in' } }, error: null }),
  } })
  assert.equal(allowed, true)
  assert.deepEqual(events, ['signed-in'])
}

{
  const { guard, events } = guardWithState()
  const allowed = await guard({ auth: {
    getSession: async () => ({ data: { session: { user: { id: 'signed-in' } } }, error: null }),
    getUser: async () => ({ data: { user: null }, error: new Error('Network unavailable') }),
  } })
  assert.equal(allowed, false)
  assert.ok(events.some((event) => event.includes('Could not verify')))
  assert.ok(!events.includes('home'))
}

console.log('Intake schedule session checks passed.')
