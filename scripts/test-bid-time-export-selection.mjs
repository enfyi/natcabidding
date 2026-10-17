import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/admin/bid-times/export/route.ts', import.meta.url), 'utf8')
const areas = ['Area A', 'Area B', 'Area C', 'Area D', 'Area E', 'Area F', 'TMU']
let selected = areas
let exported
let requested
const status = { textContent: '' }
const button = { disabled: false }
const form = {
  querySelector: selector => selector === '[data-export-bid-times]' ? button : status,
  querySelectorAll: () => selected.map(value => ({ value })),
}
const client = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test' } } }),
    getUser: async () => ({ data: { user: { id: 'admin' } } }),
  },
  rpc: async name => ({ data: name === 'claim_current_bidder_profile'
    ? { role: 'admin' }
    : name === 'read_bidding_roster'
      ? areas.map((area_name, i) => ({ profile_id: String(i), area_name, bid_role: 'CPC' }))
      : [] }),
}
const context = vm.createContext({
  URL, URLSearchParams, Request, Response, Uint8Array, console,
  BID_YEAR: 2027, hasSystemAdminAccess: () => true,
  supabaseClient: () => client, createClient: () => client,
  getSupabaseEnv: () => ({ url: 'https://example.test', publishableKey: 'test' }),
  showActionFeedback() {}, downloadBlob() {},
  buildBidTimeExport: async bidders => {
    exported = bidders.map(bidder => bidder.area_name)
    return new Uint8Array([1])
  },
  fetch: async (path, options) => {
    requested = new URL(path, 'https://example.test')
    // Model an intermediary that retains only the last value for each key.
    const collapsed = new URLSearchParams()
    requested.searchParams.forEach((value, key) => collapsed.set(key, value))
    requested.search = collapsed.toString()
    return context.GET(new Request(requested, options))
  },
})
vm.runInContext(route.slice(route.indexOf('const AREAS'))
  .replace('export async function GET(request: Request)', 'async function GET(request)')
  .replace('roster.data as BidTimeExportBidder[]', 'roster.data')
  .replace('(windows.data || []) as BidTimeExportWindow[]', '(windows.data || [])'), context)
const start = source.indexOf('async function exportBidTimes(')
vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context)

for (selected of [areas, ['Area A', 'Area C'], ['TMU']]) {
  await context.exportBidTimes(form)
  assert.deepEqual(exported, selected)
  assert.equal(requested.searchParams.getAll('area').length, 1)
  assert.equal(button.disabled, false)
  assert.match(status.textContent, /^Exported/)
}
const legacy = await context.GET(new Request('https://example.test/?year=2027&area=Area+A&area=TMU', {
  headers: { Authorization: 'Bearer test' },
}))
assert.equal(legacy.status, 200)
assert.deepEqual(exported, ['Area A', 'TMU'])
console.log('PASS bid-time exports preserve all areas, subsets, TMU, and legacy URLs.')
