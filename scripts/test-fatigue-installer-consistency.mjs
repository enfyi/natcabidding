import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// Every reusable installer must preserve shared capacity checks when it
// replaces an RPC, even if installed after the compatibility sync script.
const routines = ['submit_rdo_bid', 'review_bidding_submission', 'save_bidder_editor']
let checked = 0
for (const file of await readdir(new URL('../database/', import.meta.url))) {
  if (!file.endsWith('.sql')) continue
  const source = await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8')
  for (const match of source.matchAll(/create or replace function (?:public|private)\.(\w+)\s*\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/gi)) {
    if (!routines.includes(match[1]) || !match[2].includes('Fatigue group % is full')) continue
    assert.ok(match[2].includes('private.fatigue_group_is_available('), `${file}: ${match[1]} must use shared fatigue capacity`)
    assert.ok(!/into\s+(area_max|crew_max)/i.test(match[2]), `${file}: ${match[1]} restores legacy fatigue limits`)
    assert.match(match[2], /line_row\.line_type\s+in\s*\('CPC',\s*'DEV'\)/i, `${file}: ${match[1]} must check developmental capacity`)
    checked++
  }
}
assert.ok(checked >= 6, `Expected multiple installers to be verified; checked ${checked}`)
console.log(`PASS ${checked} reusable RPC definitions preserve shared CPC/DEV fatigue capacity`)
