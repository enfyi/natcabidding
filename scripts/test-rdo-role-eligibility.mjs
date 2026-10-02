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
  functionSource('isDevelopmentalBidRole'),
  functionSource('rdoPreferenceForBidRole'),
  functionSource('rdoLineMatchesBidRole'),
  'this.matches = rdoLineMatchesBidRole',
  'this.isDev = isDevelopmentalBidRole',
  'this.preference = rdoPreferenceForBidRole',
].join('\n'), context)

const cpc = { lineType: 'CPC', pattern: 'S/S' }
const rDev = { lineType: 'DEV', pattern: 'R-DEV' }
const dDev = { lineType: 'DEV', pattern: 'D-DEV' }
const tmc = { lineType: 'CPC', pattern: 'TMC' }
const tmuDev = { lineType: 'DEV', pattern: 'DEV' }
const matches = context.matches

assert.equal(context.isDev('R-DEV', 'Area A'), true)
assert.equal(context.isDev('D-DEV', 'Area A'), true)
assert.equal(context.isDev('DEV', 'TMU'), true)
assert.equal(context.isDev('CPC', 'Area A'), false)
assert.equal(context.preference('R-DEV', 'Area A', 'Yes'), 'No')
assert.equal(context.preference('D-DEV', 'Area A', 'BID'), 'No')
assert.equal(context.preference('DEV', 'TMU', 'Yes'), 'No')
assert.equal(context.preference('CPC', 'Area A', 'Yes'), 'Yes')

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

const allPathsMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260930220000_cover_all_rdo_bid_entry_paths.sql', import.meta.url),
  'utf8',
)
assert.match(allPathsMigration, /create trigger intake_submissions_enforce_rdo_eligibility/)
assert.match(allPathsMigration, /create trigger rdo_lines_enforce_assignment_eligibility/)
assert.match(allPathsMigration, /GL bids do not populate RDO line assignments/)
assert.match(allPathsMigration, /private\.save_bidder_editor\(integer,uuid,jsonb,jsonb\)/)
assert.match(allPathsMigration, /gl_line_type_verified/)
assert.match(allPathsMigration, /if editor_signature is null then return/)

assert.match(source, /rdoLinesForBidder\(currentUserBidAs\(\), viewArea\)/)
assert.match(source, /rdoLinesForBidder\(selectedPerson\.bidAs, area\)/)
assert.match(source, /rdoLinesForBidder\(item\.bidAs, item\.area\)/)
assert.match(source, /data-editor-gl-line-type-verification/)

const devPreferencesMigration = fs.readFileSync(
  new URL('../supabase/migrations/20261001090000_dev_bidders_do_not_select_aws_or_mid.sql', import.meta.url),
  'utf8',
)
assert.match(devPreferencesMigration, /target\.bid_role in \('R-DEV', 'D-DEV', 'DEV'\)/)
assert.match(devPreferencesMigration, /new\.payload := new\.payload \|\| jsonb_build_object\('aws', false, 'mid', 'No'\)/)
assert.match(devPreferencesMigration, /new\.aws := false/)
assert.match(devPreferencesMigration, /new\.mid := 'No'/)

const adminEditorSql = fs.readFileSync(new URL('../database/admin_bidder_editor.sql', import.meta.url), 'utf8')
assert.match(adminEditorSql, /public\.rdo_line_matches_bid_role\(target\.bid_role/)
assert.match(adminEditorSql, /gl_line_type_verified/)

console.log('PASS bid roles cannot cross line categories; GL can use CPC or DEV after intake verification')

// Render the dashboard for each profile: all categories stay visible, but only
// eligible rows and mobile cards expose selection controls.
for (const role of ['CPC', 'R-DEV', 'D-DEV']) {
  const lines = [cpc, rDev, dDev].map((line, index) => ({
    ...line, line: String(index + 1), status: 'Open', week: ['RDO'],
  }))
  const table = { innerHTML: '' }
  const cards = { innerHTML: '' }
  const renderContext = vm.createContext({
    document: {
      getElementById: () => table,
      querySelector: (selector) => selector === '[data-member-rdo-cards]' ? cards : null,
    },
    currentViewArea: () => 'Area A',
    currentUserBidAs: () => role,
    isViewingHomeArea: () => true,
    rdoLinesForArea: () => lines,
    rdoLinesForBidder: () => lines.filter((line) => matches(line, role, 'Area A')),
    rdoLineMatchesBidRole: matches,
    selectedLineId: 'invalid',
    selectedFatigueGroup: '',
    memberRdoPresentation: 'cards',
    setText: () => {},
    rdoLineMatchesFilters: () => true,
    pendingCurrentUserRdoRequest: () => null,
    isCurrentUserRdoLine: () => false,
    lineOccupant: () => '',
    lineBidderMarkup: () => '',
    lineStatusMarkup: (_line, label) => label,
    rdoFatigueGroupBadge: () => '',
    rdoLineDisplayFatigueGroup: () => '',
    thirdDaySwingIndex: () => -1,
    shiftCell: (value) => value,
    rdoLineAwsReferenceCell: () => '',
    rdoLineMidReferenceCell: () => '',
    escapeHtml: (value) => String(value),
    dayNames: ['Sun'],
  })
  vm.runInContext(functionSource('renderRdoLines') + '\nrenderRdoLines()', renderContext)
  const eligible = lines.find((line) => matches(line, role, 'Area A'))
  assert.equal(renderContext.selectedLineId, eligible.line)
  for (const line of lines) {
    assert.ok(table.innerHTML.includes(`<td>${line.line}</td>`), `${role} sees line ${line.line}`)
    assert.ok(cards.innerHTML.includes(`Line ${line.line}</strong>`))
    const selectable = matches(line, role, 'Area A')
    assert.equal(table.innerHTML.includes(`data-line-id="${line.line}"`), selectable)
    assert.equal(cards.innerHTML.includes(`data-line-id="${line.line}"`), selectable)
  }
}
console.log('PASS all RDO categories are visible; desktop and mobile selection stays profile-restricted')
