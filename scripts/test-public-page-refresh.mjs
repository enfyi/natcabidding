import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function requestedPublicView()'), source.indexOf('function requestedLandingPage()'))
const sync = source.slice(source.indexOf('function syncNavigationUrl('), source.indexOf('function setPage('))
const window = { location: new URL('https://example.com/bidding.html?page=admin&other=keep#anchor') }
window.parent = window
window.history = { state: null, replaceState(_, __, href) { window.location = new URL(href) } }
const context = vm.createContext({ window, URL, URLSearchParams, ZLA_AREAS: ['Area A', 'Area B', 'Area C', 'Area D', 'Area E', 'Area F', 'TMU'], DEFAULT_PUBLIC_AREA: 'FAQ', DEFAULT_PUBLIC_SECTION: 'Calendar' })
vm.runInContext(helpers + sync, context)
assert.equal(vm.runInContext('requestedPublicView()', context), null)
for (const area of [...context.ZLA_AREAS, 'FAQ', 'Previous Years']) {
  for (const section of ['Calendar', 'RDO', 'Bid Time']) {
    context.area = area
    context.section = section
    vm.runInContext('syncPublicPageUrl(area, section)', context)
    const restored = vm.runInContext('requestedPublicView()', context)
    assert.equal(restored.area, area)
    assert.equal(restored.section, section)
    assert.equal(window.location.searchParams.get('other'), 'keep')
    assert.equal(window.location.hash, '#anchor')
  }
}
window.location = new URL('https://example.com/bidding.html?page=public&area=invalid&section=invalid')
assert.equal(vm.runInContext('requestedPublicView().area', context), 'FAQ')
assert.equal(vm.runInContext('requestedPublicView().section', context), 'Calendar')
vm.runInContext('syncMemberPageUrl("leave")', context)
assert.equal(window.location.searchParams.get('page'), 'leave')
assert.equal(window.location.searchParams.has('area'), false)
assert.equal(window.location.searchParams.has('section'), false)
let message
window.parent = { postMessage(data, origin) { message = { data, origin } }, get location() { throw new Error('blocked frame access') } }
vm.runInContext('syncMemberPageUrl("history")', context)
assert.equal(message.data.type, 'bidding-navigation')
assert.equal(new URLSearchParams(message.data.search).get('page'), 'history')
assert.equal(message.origin, 'https://example.com')
assert.match(source, /if \(requestedPublicView\(\)\) showPublicHome\(publicState.area, publicState.section\)/)
assert.match(source, /Object.assign\(publicState, requestedPublicView\(\) \|\| \{\}\)/)
assert.match(source, /renderPublicPage\(publicButton.dataset.publicArea,[^\n]*persistNavigation: true/)
console.log('Public refresh and frame navigation checks passed.')

let displayed
context.supabaseState = { authRestorePromise: null }
context.refreshSupabaseAccountState = async () => ({ user: { id: 'test-user' } })
context.claimSupabaseProfile = async () => ({ role: 'admin', systemAdmin: true })
context.setAuthStatus = () => {}
context.loadSupabaseReferenceData = async () => {}
context.showPublicHome = (area, section) => { displayed = { area, section } }
context.showLoggedInApp = page => { displayed = { page } }
context.publicState = { area: 'Area F', section: 'RDO' }
const restore = source.slice(source.indexOf('async function restoreSupabaseSession('), source.indexOf('async function sendSupabaseLoginLink('))
const requested = source.slice(source.indexOf('function requestedLandingPage()'), source.indexOf('function defaultLandingPageForRole()'))
vm.runInContext(requested + restore, context)
window.location = new URL('https://example.com/bidding.html?page=public&area=Area+F&section=RDO')
assert.equal(await vm.runInContext('restoreSupabaseSession()', context), true)
assert.deepEqual(displayed, { area: 'Area F', section: 'RDO' })
window.location = new URL('https://example.com/bidding.html?page=admin-tools')
assert.equal(await vm.runInContext('restoreSupabaseSession()', context), true)
assert.deepEqual(displayed, { page: 'admin-tools' })
console.log('Signed-in restoration respects both public and member views.')

const component = await readFile(new URL('../app/dashboard/dashboard-frame.tsx', import.meta.url), 'utf8')
const listener = component.slice(component.indexOf('    function receiveNavigation('), component.indexOf("    window.addEventListener('message'"))
const contentWindow = {}
context.frame = { current: { contentWindow } }
context.isBiddingLandingPage = page => ['dashboard', 'leave', 'history', 'rdos', 'admin', 'admin-tools'].includes(page)
vm.runInContext(listener.replace('event: MessageEvent', 'event'), context)
window.location = new URL('https://example.com/dashboard?page=dashboard&other=keep')
for (const page of ['leave', 'admin-tools', 'public']) {
  context.event = { origin: window.location.origin, source: contentWindow, data: { type: 'bidding-navigation', search: `?page=${page}&area=Area+F&section=RDO` } }
  vm.runInContext('receiveNavigation(event)', context)
  assert.equal(window.location.searchParams.get('page'), page)
  assert.equal(window.location.pathname, '/dashboard')
  assert.equal(window.location.searchParams.get('other'), 'keep')
}
for (const invalid of [{ origin: 'https://untrusted.example' }, { source: {} }, { data: { type: 'bidding-navigation', search: '?page=invalid' } }]) {
  context.event = { origin: window.location.origin, source: contentWindow, data: { type: 'bidding-navigation', search: '?page=admin' }, ...invalid }
  vm.runInContext('receiveNavigation(event)', context)
  assert.equal(window.location.searchParams.get('page'), 'public')
}
console.log('Dashboard bridge synchronizes the outer URL and rejects unrelated messages.')
