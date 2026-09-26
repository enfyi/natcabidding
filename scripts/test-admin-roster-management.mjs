// Local-only Postgres regression test. Set PGLITE_MODULE to an installed PGlite
// module path, or make @electric-sql/pglite available to Node.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`
const rosterRow = (overrides = {}) => ({
  profile_id: null,
  original_area_name: 'Area A',
  original_initials: '',
  original_seniority_rank: null,
  profile_first_name: 'Bidder',
  profile_last_name: 'Test',
  profile_initials: 'BT',
  profile_email: 'bidder@example.test',
  profile_phone: '555-0100',
  profile_area_name: 'Area A',
  profile_bid_role: 'CPC',
  profile_seniority_rank: 1,
  profile_leave_slot_allowance: 288,
  profile_active: true,
  ...overrides,
})

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
await db.exec(fs.readFileSync(`${root}/database/admin_roster_management.sql`, 'utf8'))
await db.exec(`
  insert into areas (id, code, name) values
    ('${id(1)}', 'area-a', 'Area A'),
    ('${id(2)}', 'area-b', 'Area B');
  insert into bidders (id, auth_user_id, area_id, first_name, last_name, initials, email, phone, role, bid_role, seniority_rank, leave_slot_allowance) values
    ('${id(10)}', '${id(110)}', '${id(1)}', 'Admin', 'Test', 'AD', 'admin@example.test', null, 'admin', 'ADM', null, 0),
    ('${id(11)}', '${id(111)}', '${id(1)}', 'First', 'Bidder', 'B1', 'b1@example.test', '555-0001', 'controller', 'CPC', 1, 288),
    ('${id(12)}', '${id(112)}', '${id(1)}', 'Second', 'Bidder', 'B2', 'b2@example.test', '555-0002', 'controller', 'CPC', 2, 288),
    ('${id(13)}', '${id(113)}', '${id(2)}', 'Third', 'Bidder', 'B3', 'b3@example.test', '555-0003', 'controller', 'CPC', 1, 288);
  set test.uid = '${id(110)}';
  set test.email = 'admin@example.test';
  set role authenticated;
`)

const rows = [
  rosterRow({
    profile_id: id(12), original_initials: 'B2', original_seniority_rank: 2,
    profile_first_name: 'Second', profile_last_name: 'Bidder', profile_initials: 'B2',
    profile_email: 'b2@example.test', profile_phone: '555-0002', profile_seniority_rank: 1,
  }),
  rosterRow({
    profile_id: id(13), original_area_name: 'Area B', original_initials: 'B3', original_seniority_rank: 1,
    profile_first_name: 'Third', profile_last_name: 'Bidder', profile_initials: 'B3',
    profile_email: 'b3@example.test', profile_phone: '555-0003', profile_area_name: 'Area B', profile_seniority_rank: 1,
  }),
  rosterRow({
    profile_id: id(11), original_initials: 'B1', original_seniority_rank: 1,
    profile_first_name: 'Moved', profile_last_name: 'Controller', profile_initials: 'MC',
    profile_email: 'moved@example.test', profile_phone: '555-9999', profile_area_name: 'Area B',
    profile_bid_role: 'GL', profile_seniority_rank: 2, profile_leave_slot_allowance: 320,
  }),
]
const saved = (await db.query('select public.admin_save_bidder_roster_rows($1) as result', [JSON.stringify(rows)])).rows[0].result
assert.equal(saved.saved, true)
assert.equal(saved.rows_processed, 3)
await db.exec('reset role')
assert.deepEqual(
  (await db.query(`
    select b.first_name, b.last_name, b.initials, b.email, b.phone, a.name as area_name,
      b.bid_role, b.seniority_rank, b.leave_slot_allowance, b.active
    from bidders b join areas a on a.id = b.area_id where b.id = $1
  `, [id(11)])).rows[0],
  {
    first_name: 'Moved', last_name: 'Controller', initials: 'MC', email: 'moved@example.test',
    phone: '555-9999', area_name: 'Area B', bid_role: 'GL', seniority_rank: 2,
    leave_slot_allowance: 320, active: true,
  },
)
assert.equal((await db.query('select seniority_rank from bidders where id = $1', [id(12)])).rows[0].seniority_rank, 1)
console.log('PASS every editable field persists, including area, rank, role, and leave allowance')

await db.exec(`set test.uid = '${id(110)}'; set test.email = 'admin@example.test'; set role authenticated;`)
const legacyRow = rosterRow({
  original_initials: 'B2', original_seniority_rank: 1,
  profile_first_name: 'Second', profile_last_name: 'Bidder', profile_initials: 'B2',
  profile_email: 'b2@example.test', profile_phone: '555-0002', profile_seniority_rank: 1,
  profile_leave_slot_allowance: 304,
})
await db.query('select public.admin_save_bidder_roster_rows($1)', [JSON.stringify([legacyRow])])
await db.exec('reset role')
assert.equal((await db.query('select leave_slot_allowance from bidders where id = $1', [id(12)])).rows[0].leave_slot_allowance, 304)
console.log('PASS deployed legacy payload still resolves the existing bidder safely')

await db.exec(`set test.uid = '${id(112)}'; set test.email = 'b2@example.test'; set role authenticated;`)
await assert.rejects(
  () => db.query('select public.admin_save_bidder_roster_rows($1)', [JSON.stringify([legacyRow])]),
  /Admin access is required/,
)
await db.exec('reset role')
assert.equal((await db.query("select has_function_privilege('anon', 'public.admin_save_bidder_roster_rows(jsonb)', 'EXECUTE') as allowed")).rows[0].allowed, false)
assert.equal((await db.query("select prosecdef from pg_proc where oid = 'public.admin_save_bidder_roster_rows(jsonb)'::regprocedure")).rows[0].prosecdef, false)
console.log('PASS non-admin and anonymous access are denied')

await db.close()
