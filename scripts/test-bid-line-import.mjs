import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('../database/bid_line_import.sql', import.meta.url), 'utf8')
const parser = await readFile(new URL('../lib/bid-line-import.ts', import.meta.url), 'utf8')

assert.match(
  sql,
  /create or replace function private\.import_bid_line_schedule_impl\([\s\S]*?security definer/,
  'RDO writes must run through the private security-definer implementation',
)
assert.match(
  sql,
  /create or replace function public\.import_bid_line_schedule\([\s\S]*?security invoker[\s\S]*?select private\.import_bid_line_schedule_impl/,
  'the public RDO import RPC must remain a security-invoker wrapper',
)
assert.match(
  sql,
  /revoke insert, update on public\.rdo_lines, public\.rdo_line_days from anon, authenticated;/,
  'authenticated users must not receive direct RDO table write access',
)
assert.doesNotMatch(
  sql,
  /grant insert(?:, update)? on public\.(?:rdo_lines|rdo_line_days|audit_events) to authenticated;/,
  'the importer must not restore direct table writes to authenticated users',
)
assert.match(
  parser,
  /const requiredHeaders = \['line_code', 'four_ten'/,
  'four_ten must be a required import column',
)
assert.match(
  parser,
  /if \(!normalized\) \{\s*issues\.push\(`\$\{rowReference\(row\)\}: \$\{label\} must be Yes or No\.`\)/,
  'blank required boolean cells must produce a validation issue',
)

console.log('Bid-line import security and validation regression checks passed.')
