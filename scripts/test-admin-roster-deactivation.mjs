// Local-only Postgres regression test. Set PGLITE_MODULE to an installed PGlite
// module path, or make @electric-sql/pglite available to Node.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql as $$
    select jsonb_build_object('email', current_setting('test.email', true))
  $$;
`)
await db.exec(fs.readFileSync(`${root}/database/schema.sql`, 'utf8').replace('create extension if not exists pgcrypto;', ''))
await db.exec(fs.readFileSync(`${root}/database/admin_roster_deactivation.sql`, 'utf8'))
await db.exec(`
  insert into bid_years (id, bid_year) values ('${id(1)}', 2027);
  insert into areas (id, code, name) values ('${id(2)}', 'area-a', 'Area A');
  insert into bidders (id, auth_user_id, area_id, first_name, last_name, initials, email, role, bid_role, seniority_rank) values
    ('${id(10)}', '${id(110)}', '${id(2)}', 'Admin', 'Test', 'AD', 'admin@example.test', 'admin', 'ADM', null),
    ('${id(11)}', '${id(111)}', '${id(2)}', 'Bidder', 'One', 'B1', 'bidder1@example.test', 'controller', 'CPC', 1),
    ('${id(12)}', '${id(112)}', '${id(2)}', 'Bidder', 'Two', 'B2', 'bidder2@example.test', 'controller', 'CPC', 2);
  insert into bid_windows (id, bid_year_id, bidder_id, round_number, opens_at, closes_at)
  values ('${id(20)}', '${id(1)}', '${id(11)}', 1, '2026-10-01T16:00:00Z', '2026-10-01T18:00:00Z');
  set test.uid = '${id(110)}';
  set test.email = 'admin@example.test';
  set role authenticated;
`)

const deleted = (await db.query(
  'select * from public.admin_deactivate_bidder_roster_entry($1)',
  [id(11)],
)).rows[0]
assert.deepEqual(deleted, { profile_id: id(11), active: false })
await db.exec('reset role')
assert.deepEqual(
  (await db.query('select active, seniority_rank from bidders where id = $1', [id(11)])).rows[0],
  { active: false, seniority_rank: null },
)
assert.equal((await db.query('select count(*)::integer as count from bid_windows where bidder_id = $1', [id(11)])).rows[0].count, 1)
assert.equal((await db.query("select count(*)::integer as count from audit_events where entity_id = $1 and event_type = 'bidder.deactivated'", [id(11)])).rows[0].count, 1)
console.log('PASS bidder is removed from active roster while linked history is retained')

await db.exec('set role authenticated')
await assert.rejects(
  () => db.query('select * from public.admin_deactivate_bidder_roster_entry($1)', [id(10)]),
  /currently using/,
)
console.log('PASS admin cannot delete the active account')

await db.exec(`
  reset role;
  set test.uid = '${id(112)}';
  set test.email = 'bidder2@example.test';
  set role authenticated;
`)
await assert.rejects(
  () => db.query('select * from public.admin_deactivate_bidder_roster_entry($1)', [id(10)]),
  /Admin access is required/,
)
console.log('PASS non-admin deletion is denied')

await db.exec('reset role')
assert.equal((await db.query("select has_function_privilege('anon', 'public.admin_deactivate_bidder_roster_entry(uuid)', 'EXECUTE') as allowed")).rows[0].allowed, false)
assert.equal((await db.query("select has_function_privilege('authenticated', 'public.admin_deactivate_bidder_roster_entry(uuid)', 'EXECUTE') as allowed")).rows[0].allowed, true)
assert.equal((await db.query("select prosecdef from pg_proc where oid = 'public.admin_deactivate_bidder_roster_entry(uuid)'::regprocedure")).rows[0].prosecdef, false)
console.log('PASS function execution permissions')

await db.close()
