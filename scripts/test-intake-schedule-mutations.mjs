import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const markup = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')
const migration = await readFile(
  new URL('../supabase/migrations/20260928222325_intake_schedule_mutations.sql', import.meta.url),
  'utf8',
)

assert.match(markup, /data-cancel-intake-schedule-edit/)
assert.match(source, /data-edit-intake-schedule=/)
assert.match(source, /data-delete-intake-schedule=/)
assert.match(source, /client\.rpc\(routine, parameters\)/)
assert.match(source, /routine = scheduleId \? "update_intake_schedule" : "create_intake_schedule"/)
assert.match(source, /client\.rpc\("delete_intake_schedule"/)
assert.match(source, /window\.confirm\(`Delete \$\{schedule\.name\}'s intake shift/)
assert.doesNotMatch(source, /\.from\("intake_schedules"\)[\s\S]{0,100}\.(update|delete)\(/)

assert.match(migration, /create or replace function public\.update_intake_schedule\(/)
assert.match(migration, /create or replace function public\.delete_intake_schedule\(/)
assert.match(migration, /security definer\s+set search_path = ''/)
assert.match(migration, /auth\.uid\(\) is null or not public\.is_current_intake_or_admin\(\)/)
assert.match(migration, /revoke all on function public\.update_intake_schedule[\s\S]*from public, anon, authenticated/)
assert.match(migration, /grant execute on function public\.update_intake_schedule[\s\S]*to authenticated/)
assert.match(migration, /revoke all on function public\.delete_intake_schedule[\s\S]*from public, anon, authenticated/)
assert.match(migration, /grant execute on function public\.delete_intake_schedule[\s\S]*to authenticated/)
assert.match(migration, /'intake_shift_updated'/)
assert.match(migration, /'intake_shift_deleted'/)

console.log('Intake schedule edit/delete regression checks passed.')
