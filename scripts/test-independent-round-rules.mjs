import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8')

function extract(name) {
  const functionStart = source.indexOf(`function ${name}(`)
  const asyncStart = source.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : functionStart
  assert.ok(start >= 0, `${name} must exist`)
  let index = source.indexOf('{', start)
  let depth = 1
  let end = index + 1
  while (depth && end < source.length) {
    if (source[end] === '{') depth++
    if (source[end] === '}') depth--
    end++
  }
  return source.slice(start, end)
}

const calls = []
const configuredRules = {
  1: { label: 'Round 1 limit', detail: 'Round 1 rule' },
  2: { label: 'Round 2 limit', detail: 'Round 2 rule' },
}
const context = vm.createContext({
  BID_YEAR: 2027,
  roundRules: configuredRules,
  supabaseState: { connected: true },
  supabaseClient: () => ({
    rpc: async (name, payload) => {
      calls.push({ name, payload })
      return {
        data: {
          ...configuredRules,
          [payload.requested_round]: {
            label: payload.rule_label,
            detail: payload.rule_detail,
          },
        },
        error: null,
      }
    },
  }),
  isMissingSupabaseRoutine: () => false,
  applyRoundRules: (rules) => {
    context.roundRules = rules
  },
})

vm.runInContext(
  [extract('roundRuleForRound'), extract('saveSupabaseRoundRule')].join('\n'),
  context,
)

await context.saveSupabaseRoundRule(1, 'Updated Round 1 limit', 'Updated Round 1 rule')

assert.equal(calls.length, 1, 'saving one round must make exactly one database write')
assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
  name: 'set_round_rule',
  payload: {
    requested_bid_year: 2027,
    requested_round: 1,
    rule_label: 'Updated Round 1 limit',
    rule_detail: 'Updated Round 1 rule',
  },
})
assert.equal(context.roundRuleForRound(1).detail, 'Updated Round 1 rule')
assert.equal(context.roundRuleForRound(2).detail, 'Round 2 rule')

console.log('Round rule saves remain independent.')
