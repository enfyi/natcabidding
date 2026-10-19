import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
// Use an installed PGlite package, or set PGLITE_MODULE to its module path.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')

const db = new PGlite()
await db.exec(`
  create schema private;
  create role anon;
  create role authenticated;
  create table public.rdo_lines (
    id integer primary key, bid_year_id integer, assigned_bidder_id integer,
    assigned_initials text, status text, updated_at timestamptz
  );
  create table public.intake_submissions (
    id integer primary key, bid_year_id integer, bidder_id integer,
    submission_type text, status text, is_change boolean,
    rdo_line_id integer, payload jsonb, updated_at timestamptz
  );
`)
const migration = await readFile(new URL('../database/release_approved_rdo_on_pending_change.sql', import.meta.url), 'utf8')
await db.exec(migration.slice(migration.indexOf('create or replace function private.release_approved_rdo_on_pending_change()'), migration.indexOf('create or replace function private.reject_unchanged_leave_rebid()')))
await db.exec(`
  insert into rdo_lines values (1,2027,10,'AB','taken',now()),(2,2027,20,'CD','taken',now());
  insert into intake_submissions values (1,2027,10,'rdo','approved',false,1,'{}',now());
  insert into intake_submissions values (2,2027,10,'rdo','pending',true,2,'{}',now());
`)
assert.equal((await db.query('select status from rdo_lines where id=1')).rows[0].status, 'open')
assert.equal((await db.query('select assigned_bidder_id from rdo_lines where id=1')).rows[0].assigned_bidder_id, null)
assert.equal((await db.query('select status from intake_submissions where id=1')).rows[0].status, 'expired')
assert.equal((await db.query('select status from rdo_lines where id=2')).rows[0].status, 'taken')
await db.exec("update intake_submissions set status='denied' where id=2")
assert.equal((await db.query('select status from rdo_lines where id=1')).rows[0].status, 'open')
// A fresh approval populates the replacement and is not cleared by the trigger.
await db.exec(`
  insert into intake_submissions values (3,2027,10,'rdo','pending',true,1,'{}',now());
  update rdo_lines set status='taken',assigned_bidder_id=10,assigned_initials='AB' where id=1;
  update intake_submissions set rdo_line_id=1 where id=3;
  update intake_submissions set status='approved' where id=3;
`)
assert.equal((await db.query('select status from rdo_lines where id=1')).rows[0].status, 'taken')
// First bids do not release assignments; failed transactions leave them intact.
await db.exec("insert into intake_submissions values (4,2027,20,'rdo','pending',false,2,'{}',now())")
assert.equal((await db.query('select status from rdo_lines where id=2')).rows[0].status, 'taken')
await db.exec('begin')
await db.exec("insert into intake_submissions values (5,2027,10,'rdo','pending',true,1,'{}',now())")
await db.exec('rollback')
assert.equal((await db.query('select status from rdo_lines where id=1')).rows[0].status, 'taken')
await db.close()

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const extract = (name) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1))
const context = vm.createContext({
  currentUser: { initials: 'AB', area: 'Area A' }, intakeQueue: [],
  submittedRdoLineForInitials: () => ({ week: ['RDO','RDO','0600','0600','0600','0600','0600'] }),
  rdoLinesForBidder: () => [], currentUserBidAs: () => 'CPC', selectedLineId: '1',
})
vm.runInContext(['rdoRequestAwaitingApproval', 'selectedRdoWeekdays', 'rdoWeekdaysForLine'].map(extract).join('\n'), context)
for (const status of ['Pending', 'Denied', 'Approved']) {
  context.intakeQueue = [{ type:'RDO Line', initials:'AB', area:'Area A', isChange:true, status }]
  assert.equal(vm.runInContext('selectedRdoWeekdays().size', context), status === 'Approved' ? 2 : 0)
}
console.log('PASS pending RDO changes release prior assignments, preserve history, and wait for approval on the calendar')
