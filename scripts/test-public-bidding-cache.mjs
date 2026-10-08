import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const helper = source.slice(source.indexOf('function publicBiddingReadUrl('), source.indexOf('\nfunction hasActiveLiveDataEditing'))
const requests = []
const ctx = vm.createContext({ URL, BID_YEAR: 2027,
  supabaseState: { authUserId: '' }, liveDataWritesPending: 0, liveDataActivityRevision: 0,
  scheduleLiveDataRefresh() {}, window: {
    location: { href: 'https://example.org/bidding/bidding.html' },
    NATCA_SUPABASE_CONFIG: { url: 'https://example.supabase.co', environment: 'production' },
    fetch: async (...args) => { requests.push(args); return new Response('[]') },
  }, Response,
})
vm.runInContext(helper, ctx)
await ctx.fetchWithLiveUpdateTracking('https://example.supabase.co/rest/v1/rpc/read_public_leave_slots', {
  method: 'POST', body: JSON.stringify({ requested_bid_year: 2028 }), headers: { Authorization: 'private-member-token' },
})
assert.equal(requests[0][0].pathname, '/bidding/api/public/bidding')
assert.equal(requests[0][0].searchParams.get('year'), '2028')
assert.equal(requests[0][1].credentials, 'omit')
assert.equal(requests[0][1].headers, undefined)
ctx.supabaseState.authUserId = 'member'
await ctx.fetchWithLiveUpdateTracking('https://example.supabase.co/rest/v1/rpc/read_public_leave_slots', { method: 'POST' })
assert.equal(requests[1][0], 'https://example.supabase.co/rest/v1/rpc/read_public_leave_slots')
ctx.supabaseState.authUserId = ''
for (const path of ['rpc/read_bidding_state', 'intake_submissions', 'rpc/review_bidding_submission']) {
  assert.equal(ctx.publicBiddingReadUrl(new URL(`https://example.supabase.co/rest/v1/${path}`), {}, 'POST'), null)
}
ctx.window.NATCA_SUPABASE_CONFIG.environment = 'pilot'
assert.equal(ctx.publicBiddingReadUrl(new URL('https://example.supabase.co/rest/v1/areas'), {}, 'GET'), null)

const route = await readFile(new URL('../app/api/public/bidding/route.ts', import.meta.url), 'utf8')
let upstreamCalls = 0, upstreamOptions, upstreamUrl, fail = false
const exports = {}
const routeCode = stripTypeScriptTypes(route).replace(/import[^\n]+\n/, '')
  .replaceAll('export ', '') + '\nexports.GET = GET;'
vm.runInNewContext(routeCode, {
  exports, URL, Response, AbortSignal,
  getSupabaseEnv: () => ({ url: 'https://example.supabase.co', publishableKey: 'public-key' }),
  fetch: async (url, options) => {
    upstreamCalls++; upstreamOptions = options; upstreamUrl = url
    return fail ? new Response('{}', { status: 504 }) : Response.json([{ initials: 'AB', email: 'private', phone: 'private' }])
  },
})
const request = resource => new Request(`https://example.org/api/public/bidding?resource=${resource}&year=2027`, {
  headers: { Authorization: 'private-member-token', Cookie: 'private-session' },
})
for (const resource of ['intake_submissions', 'read_bidding_state', 'review_bidding_submission', '__proto__']) {
  assert.equal((await exports.GET(request(resource))).status, 400)
}
assert.equal(upstreamCalls, 0, 'Private resources cannot reach the database through the public cache')
const roster = await exports.GET(request('read_bidding_roster'))
assert.deepEqual(await roster.json(), [{ initials: 'AB', email: null, phone: null }])
assert.equal(upstreamOptions.headers.apikey, 'public-key')
assert.equal(upstreamOptions.headers.Authorization, undefined)
assert.equal(upstreamOptions.headers.Cookie, undefined)
assert.equal(upstreamOptions.body, JSON.stringify({ include_inactive: false }))
assert.equal(upstreamOptions.cache, 'force-cache')
assert.match(roster.headers.get('Cache-Control'), /s-maxage=30/)
await exports.GET(request('faq_entries'))
assert.equal(upstreamUrl.searchParams.get('published'), 'eq.true')
fail = true
const failed = await exports.GET(request('read_public_leave_slots'))
assert.equal(failed.status, 504)
assert.equal(failed.headers.get('Cache-Control'), 'no-store')
console.log('PASS public reads share a cache; member credentials, private resources and failed responses stay out.')
