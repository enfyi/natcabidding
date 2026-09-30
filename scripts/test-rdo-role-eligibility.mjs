import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../bidding.js', import.meta.url), 'utf8')

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nfunction ', start + 10)
  return source.slice(start, next === -1 ? source.length : next)
}

const context = vm.createContext({})
vm.runInContext([
  functionSource('isCpcLine'),
  functionSource('normalizeBidRoleForArea'),
  functionSource('rdoLineMatchesBidRole'),
  'this.matches = rdoLineMatchesBidRole',
].join('\n'), context)

const cpc = { lineType: 'CPC', pattern: 'S/S' }
const rDev = { lineType: 'DEV', pattern: 'R-DEV' }
const dDev = { lineType: 'DEV', pattern: 'D-DEV' }
const tmc = { lineType: 'CPC', pattern: 'TMC' }
const tmuDev = { lineType: 'DEV', pattern: 'DEV' }
const matches = context.matches

assert.equal(matches(cpc, 'CPC', 'Area A'), true)
assert.equal(matches(rDev, 'CPC', 'Area A'), false)
assert.equal(matches(dDev, 'CPC', 'Area A'), false)
assert.equal(matches(rDev, 'R-DEV', 'Area A'), true)
assert.equal(matches(cpc, 'R-DEV', 'Area A'), false)
assert.equal(matches(dDev, 'R-DEV', 'Area A'), false)
assert.equal(matches(dDev, 'D-DEV', 'Area A'), true)
assert.equal(matches(rDev, 'D-DEV', 'Area A'), false)
assert.equal(matches(tmc, 'TMC', 'TMU'), true)
assert.equal(matches(tmuDev, 'TMC', 'TMU'), false)
assert.equal(matches(tmuDev, 'DEV', 'TMU'), true)
assert.equal(matches(tmc, 'DEV', 'TMU'), false)
for (const line of [cpc, rDev, dDev]) assert.equal(matches(line, 'GL', 'Area A'), true)
for (const line of [tmc, tmuDev]) assert.equal(matches(line, 'GL', 'TMU'), true)

assert.match(source, /data-gl-line-type-verification/)
assert.match(source, /All GL rules still apply/)

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260930210000_enforce_bid_role_line_eligibility.sql', import.meta.url),
  'utf8',
)
assert.match(migration, /bidder_role = 'GL' then requested_line_type in \('CPC', 'DEV'\)/)
assert.match(migration, /bidder_role = 'R-DEV' then requested_line_type = 'DEV' and requested_pattern = 'R-DEV'/)
assert.match(migration, /area_name = 'TMU' and bidder_role = 'TMC' then requested_line_type = 'CPC'/)
assert.match(migration, /glLineTypeVerified/)
assert.match(source, /glLineTypeVerified: item\.bidAs !== "GL" \|\| Boolean\(item\.glLineTypeVerified\)/)

console.log('PASS bid roles cannot cross line categories; GL can use CPC or DEV after intake verification')
