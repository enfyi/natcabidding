import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const lookup = source.slice(source.indexOf('function bidWindowForRankRound('), source.indexOf('function currentUserSeniorityRank('))
const reader = source.slice(source.indexOf('async function loadPublishedBidWindows('), source.indexOf('async function loadPublishedLeaveSlots('))
const saved = { round: 1, start: new Date('2026-10-05T14:00:00Z'), end: new Date('2026-10-05T16:00:00Z') }
let result = saved
const context = vm.createContext({
  currentViewArea: () => 'Area A',
  databaseBidWindowForRankRound: () => result,
  supabaseState: { authUserId: null },
  BID_YEAR: 2027,
})
vm.runInContext(lookup + reader, context)
assert.equal(context.bidWindowForRankRound(1, 1), saved, 'Saved October 5 window must be used unchanged')
result = null
assert.equal(context.bidWindowForRankRound(1, 1), null, 'Loading, missing, or failed windows must not produce October 1 times')

let response = { data: [saved], error: null }
const client = {
  async rpc(name, args) {
    assert.equal(name, 'read_public_bid_windows')
    assert.equal(args.requested_bid_year, 2027)
    return response
  },
  from() { throw new Error('Signed-out users must use the public reader') },
}
assert.equal(await context.loadPublishedBidWindows(client, 'year-id'), response)
response = { data: null, error: { message: 'Temporary network failure' } }
assert.equal(await context.loadPublishedBidWindows(client, 'year-id'), response)
assert.equal(context.bidWindowForRankRound(1, 1), null)
assert.match(source, /applyBidWindowsFromDatabase\(supabaseRows\(bidWindowsResult\)\)/, 'A failed refresh must clear obsolete windows')
console.log('Published bid windows remain authoritative during signed-out loading and read failures.')
