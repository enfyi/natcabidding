import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const landing = source.slice(source.indexOf('function requestedLandingPage()'), source.indexOf('function supabaseAuthRedirectUrl()'))
const sync = source.slice(source.indexOf('function syncNavigationUrl('), source.indexOf('function setPage('))
let admin = false
let intake = false
function mockWindow(href) {
  const result = { location: new URL(href), postMessage() {} }
  result.history = { state: { preserved: true }, replaceState(state, _, url) {
    assert.equal(this, result.history, 'History method must receive its owning History instance')
    assert.deepEqual(state, { preserved: true })
    result.location = new URL(url)
  } }
  result.parent = result
  return result
}
const window = mockWindow('https://example.com/bidding/bidding.html?member=1#anchor')
const context = vm.createContext({ window, URL, URLSearchParams, hasSystemAdminAccess: () => admin, canUseIntakeView: () => intake, canViewIntakeSchedule: () => intake })
const historyHelper = source.slice(source.indexOf('function replaceBrowserHistory('), source.indexOf('function adoptParentSupabaseAuthHash('))
vm.runInContext(historyHelper + landing + sync, context)
const pages = ['dashboard', 'seniority', 'rdos', 'leave', 'calendar', 'history', 'profile', 'intake', 'intake-schedule', 'admin', 'admin-tools']
admin = intake = true
for (const page of pages) {
  context.page = page
  vm.runInContext('syncMemberPageUrl(page)', context)
  assert.equal(vm.runInContext('intendedLandingPage()', context), page)
  assert.equal(window.location.searchParams.get('member'), '1')
  assert.equal(window.location.hash, '#anchor')
}
window.parent = mockWindow('https://example.com/bidding/dashboard?other=keep')
context.page = 'leave'
vm.runInContext('syncMemberPageUrl(page)', context)
assert.equal(window.parent.location.searchParams.get('page'), 'leave')
assert.equal(window.parent.location.searchParams.get('other'), 'keep')
admin = intake = false
for (const page of ['admin', 'admin-tools', 'intake', 'intake-schedule', 'unknown']) {
  context.page = page
  assert.equal(vm.runInContext('intendedLandingPage(page)', context), 'dashboard')
}
window.parent = { postMessage() {}, get location() { throw new Error('cross-origin') } }
assert.doesNotThrow(() => vm.runInContext('syncMemberPageUrl("history")', context))
assert.equal(vm.runInContext('intendedLandingPage()', context), 'history')
assert.match(source, /syncMemberPageUrl\(pageName\);/)
const serverLanding = await readFile(new URL('../lib/auth-landing.ts', import.meta.url), 'utf8')
for (const page of pages) assert.ok(serverLanding.includes(`'${page}'`))
console.log('Page refresh navigation checks passed.')

window.history.replaceState = function () { throw new TypeError('Call only History.replaceState on instances of History') }
assert.doesNotThrow(() => vm.runInContext('syncMemberPageUrl("dashboard")', context))
const authCode = source.slice(source.indexOf('function adoptParentSupabaseAuthHash('), source.indexOf('function supabaseClient('))
  + source.slice(source.indexOf('function clearSupabaseEmailTokenFromUrl('), source.indexOf('function showPendingSupabaseEmailConfirmation('))
vm.runInContext(authCode, context)
assert.doesNotThrow(() => context.clearSupabaseEmailTokenFromUrl())
window.self = window
window.top = mockWindow('https://example.com/dashboard#access_token=test')
window.location = new URL('https://example.com/bidding.html')
context.adoptParentSupabaseAuthHash()
assert.equal(window.top.location.hash, '#access_token=test', 'Keep auth tokens when adoption fails')
window.history = mockWindow('https://example.com/bidding.html').history
window.top.history.replaceState = function () { throw new TypeError('Call only History.replaceState on instances of History') }
assert.doesNotThrow(() => context.adoptParentSupabaseAuthHash())
console.log('History receiver and authentication URL failure checks passed.')
