import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('../database/bid_line_import.sql', import.meta.url), 'utf8')
const parser = await readFile(new URL('../lib/bid-line-import.ts', import.meta.url), 'utf8')
const editorMigration = await readFile(new URL('../supabase/migrations/20260930180000_bid_line_editor.sql', import.meta.url), 'utf8')
const editor = await readFile(new URL('../app/admin/bid-lines/bid-line-importer.tsx', import.meta.url), 'utf8')
const bidding = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')

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
  /revoke insert, update, delete on public\.rdo_lines, public\.rdo_line_days from anon, authenticated;/,
  'authenticated users must not receive direct RDO table write access',
)
assert.doesNotMatch(
  sql,
  /grant (?:insert|update|delete)(?:, (?:insert|update|delete))* on public\.(?:rdo_lines|rdo_line_days|audit_events) to authenticated;/,
  'the importer must not restore direct table writes to authenticated users',
)
assert.match(
  sql,
  /create or replace function private\.admin_delete_bid_line_impl\(target_line_id uuid\)[\s\S]*?security definer[\s\S]*?if not \(select public\.is_current_admin\(\)\)/,
  'bid-line deletion must run through a private admin-checked security-definer implementation',
)
assert.match(
  sql,
  /if exists \([\s\S]*?from public\.intake_submissions[\s\S]*?bidding history/,
  'bid lines with submission history must be protected from deletion',
)
assert.match(
  sql,
  /create index if not exists intake_submissions_rdo_line_id_idx\s+on public\.intake_submissions\(rdo_line_id\)/,
  'the submission-history delete guard must use an indexed foreign key',
)
assert.match(
  sql,
  /create or replace function public\.admin_delete_bid_line\(target_line_id uuid\)[\s\S]*?security invoker[\s\S]*?private\.admin_delete_bid_line_impl/,
  'the public bid-line delete RPC must remain a security-invoker wrapper',
)
assert.match(
  parser,
  /const requiredHeaders = \['line_code', 'four_ten'/,
  'four_ten must be a required import column',
)

assert.match(editorMigration, /add column if not exists display_order integer/, 'bid lines must persist a display order')
assert.match(
  editorMigration,
  /create or replace function private\.admin_save_bid_line_impl[\s\S]*?if not \(select public\.is_current_admin\(\)\)/,
  'line edits must run through an admin-checked security-definer function',
)
assert.match(
  editorMigration,
  /create or replace function private\.admin_reorder_bid_lines_impl[\s\S]*?if not \(select public\.is_current_admin\(\)\)/,
  'line reordering must run through an admin-checked security-definer function',
)
assert.match(editor, /admin_save_bid_line/, 'the admin editor must save individual lines through the secure RPC')
assert.match(editor, /admin_reorder_bid_lines/, 'the admin editor must persist reordered lines through the secure RPC')
assert.match(editor, /Mid Bid line/, 'the admin editor must expose the Mid Bid designation')
assert.match(editor, /R-DEV[\s\S]*D-DEV/, 'the admin editor must expose both development-line designations')
assert.match(bidding, /displayOrder: row\.display_order/, 'the bidder view must load the persisted line order')
assert.match(
  parser,
  /if \(!normalized\) \{\s*issues\.push\(`\$\{rowReference\(row\)\}: \$\{label\} must be Yes or No\.`\)/,
  'blank required boolean cells must produce a validation issue',
)

console.log('Bid-line import security and validation regression checks passed.')
