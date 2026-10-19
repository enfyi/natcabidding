import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const saveSource = source.match(/async function saveSupabaseManualRdoRequest\(request, person, area\) \{[\s\S]*?\n\}/)[0]
const calls = []
const user = { supabaseProfileId: 'actor', role: 'intake' }
const save = vm.runInNewContext(`${saveSource}; saveSupabaseManualRdoRequest`, {
  currentUser: user, BID_YEAR: 2027, selectedBidYearErrorMessage: () => '',
  supabaseClient: () => ({ rpc: async (name, payload) => {
    calls.push({ name, payload }); return { data: { submission_id: 'saved' }, error: null }
  } }),
})
const request = { line: '4', fatigueGroup: 'A', fatigueOverride: true, flex: 'Yes', aws: 'No', mid: 'No', round: 1 }
for (const role of ['intake', 'admin']) {
  user.role = role
  await save(request, { initials: 'AB' }, 'Area A')
  assert.equal(calls.at(-1).name, 'submit_manual_rdo_fatigue_override')
  assert.equal(calls.at(-1).payload.requested_fatigue_group, 'A')
  assert.equal(calls.at(-1).payload.manual_entry, true)
}
for (const role of ['bue', 'system', undefined]) {
  user.role = role
  const before = calls.length
  await assert.rejects(save(request, { initials: 'AB' }, 'Area A'), /Only intake and admin/)
  assert.equal(calls.length, before, 'Unauthorized override must never call the RPC')
}
user.role = 'intake'
await save({ ...request, fatigueOverride: false }, { initials: 'AB' }, 'Area A')
assert.equal(calls.at(-1).name, 'submit_rdo_bid')

const hydrateSource = source.match(/function supabaseRdoSubmissionToIntakeItem\(row, areaById = new Map\(\)\) \{[\s\S]*?\n\}/)[0]
assert.match(hydrateSource, /fatigueOverride: payload.fatigueOverride === true/)
assert.match(source, /if \(!item.fatigueOverride && !fatigueGroupIsAvailableForLine/)
assert.match(source, /if \(item.line !== originalLine \|\| item.fatigueGroup !== originalGroup\) item.fatigueOverride = false/)

const sql = await readFile(new URL('../database/manual_fatigue_override.sql', import.meta.url), 'utf8')
assert.match(sql, /actor.role not in \('admin', 'intake'\)/)
assert.match(sql, /auth_user_id = auth.uid\(\)/)
assert.match(sql, /lower\(email\) = lower\(auth.jwt\(\)->>'email'\) and active/)
assert.match(sql, /revoke all on private.manual_rdo_fatigue_overrides from public, anon, authenticated/)
assert.match(sql, /where submission_id = requested_submission_id and line_id = requested_line_id\s+and fatigue_group = requested_group/)
assert.match(sql, /'manual_fatigue_override'/)
assert.match(sql, /after update of payload, rdo_line_id on public.intake_submissions/)
assert.match(sql, /new.payload->>'fatigueOverride' is distinct from 'true'/)
for (const file of ['transactional_bidding', 'high_priority_bidding_fixes', 'holiday_leave_round_rules']) {
  const installer = await readFile(new URL(`../database/${file}.sql`, import.meta.url), 'utf8')
  assert.match(installer, /and not private.rdo_fatigue_override_authorized\(submission.id, line_row.id, requested_group\)/)
}
console.log('PASS manual fatigue override staff access, RPC routing, persistence, scope binding, and protected approval checks')
