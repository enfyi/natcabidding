import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migrations/20261005145517_approve_rdo_without_fatigue_preference.sql', import.meta.url), 'utf8')
const approval = source.match(/async function approveIntakeItem\(id\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(approval, 'Intake approval handler must exist')

async function review(group, groupAvailable = true) {
  const item = {
    id: 'bid-1', status: 'Pending', type: 'RDO Line', bidAs: 'CPC',
    ghostBid: false, fatigueGroup: group, line: '1', area: 'Area A',
  }
  let saved = 0
  let capacityChecks = 0
  const context = vm.createContext({
    intakeReviewItemById: () => item,
    activeOverrideId: null,
    activeDenialId: null,
    rdoLines: [{ line: '1' }],
    lineForArea: () => true,
    fatigueGroupIsAvailableForLine: () => {
      capacityChecks += 1
      return groupAvailable
    },
    persistIntakeDecision: async () => {
      saved += 1
      return true
    },
    queueBidVerifiedEmail: () => {},
    updateConfirmedIntakeDecision: (item) => { item.status = 'Approved' },
    supabaseState: {},
    refreshBiddingAfterIntakeDecision: async () => {
      assert.equal(item.status, 'Approved', 'Pending notification clears before refresh')
    },
    renderApp: () => {},
    setPage: () => {},
  })
  vm.runInContext(approval, context)
  await vm.runInContext("approveIntakeItem('bid-1')", context)
  return { item, saved, capacityChecks }
}

const noPreference = await review('')
assert.equal(noPreference.saved, 1, 'No preference must be approvable')
assert.equal(noPreference.capacityChecks, 0, 'An unassigned group must not consume group capacity')

const availableGroup = await review('A')
assert.equal(availableGroup.saved, 1)
assert.equal(availableGroup.capacityChecks, 1)

const fullGroup = await review('B', false)
assert.equal(fullGroup.saved, 0, 'A full selected group must still be blocked')
assert.match(fullGroup.item.reviewNote, /full/)

const invalidGroup = await review('Z')
assert.equal(invalidGroup.saved, 0, 'Invalid non-empty groups must still be blocked')

assert.match(migration, /to_regprocedure\('public\.review_bidding_submission\(uuid,text,text,jsonb\)'\)/)
assert.match(migration, /requested_group := nullif\(trim\(coalesce/)
assert.match(migration, /if requested_group is not null and line_row\.line_type in/)
assert.match(migration, /review_bidding_submission changed; review its fatigue-group validation/)

for (const path of [
  '../database/transactional_bidding.sql',
  '../database/high_priority_bidding_fixes.sql',
  '../database/holiday_leave_round_rules.sql',
]) {
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  assert.match(sql, /requested_group := nullif\(trim\(coalesce/)
  assert.match(sql, /if requested_group is not null and requested_group not in/)
}

console.log('Intake no-preference approval checks passed.')
