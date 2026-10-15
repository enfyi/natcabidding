// Optional integration test: install @electric-sql/pglite in a temporary directory,
// then set PGLITE_MODULE to its absolute package directory. No live database is used.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE || '@electric-sql/pglite')
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('..', import.meta.url))
const db = new PGlite()
await db.exec(`
  create role anon; create role authenticated;
  create table public.bid_years (id uuid primary key, bid_year integer unique);
  create table public.bidding_site_settings (singleton boolean, active_bid_year_id uuid);
  insert into public.bid_years values ('00000000-0000-0000-0000-000000000001', 2027);
  insert into public.bidding_site_settings values (true, '00000000-0000-0000-0000-000000000001');
  create function public.is_current_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'false') = 'true' $$;
  create function public.read_public_bid_windows(integer) returns jsonb language sql stable as $$ select '[{"round_number":1,"opens_at":"2026-10-01T15:00:00Z","closes_at":"2026-10-15T23:00:00Z"},{"round_number":2,"opens_at":"2026-10-16T16:00:00Z","closes_at":"2026-10-22T23:00:00Z"},{"round_number":2,"opens_at":"2026-10-16T15:00:00Z","closes_at":"2026-10-23T01:00:00Z"}]'::jsonb $$;
`)
await db.exec(await readFile(`${root}/supabase/migrations/20261015164831_round_announcements.sql`, 'utf8'))
await db.exec(`insert into public.round_announcements select bid_year, 3, false, color, mode, title, body, public_link_label, public_link_url, member_link_label, member_link_url, starts_at, ends_at from public.round_announcements where round_number = 2`)
await db.exec('set role anon')
assert.equal((await db.query('select * from public.round_announcements')).rows.length, 1)
const schedule = (await db.query('select public.read_round_announcement_schedule(2027) as schedule')).rows[0].schedule
assert.equal(schedule.length, 2)
assert.equal(Date.parse(schedule[1].starts_at), Date.parse('2026-10-16T15:00:00Z'))
assert.equal(Date.parse(schedule[1].ends_at), Date.parse('2026-10-23T01:00:00Z'))
await assert.rejects(db.query(`update public.round_announcements set title = 'unauthorized'`), /permission denied/)
await db.exec('reset role; set role authenticated')
assert.equal((await db.query(`update public.round_announcements set title = 'unauthorized' returning *`)).rows.length, 0)
await assert.rejects(db.query(`insert into public.round_announcements (bid_year, round_number, title, public_link_label, public_link_url, member_link_label, member_link_url) values (2027, 4, 'bad', 'link', 'login', 'link', 'login')`), /row-level security/)
await db.exec("set test.admin = 'true'")
assert.equal((await db.query('select * from public.round_announcements')).rows.length, 2)
assert.equal((await db.query(`update public.round_announcements set title = 'Edited', color = 'blue' where round_number = 2 returning *`)).rows[0].title, 'Edited')
await assert.rejects(db.query(`update public.round_announcements set member_link_url = 'javascript:alert(1)' where round_number = 2`), /check constraint/)
await assert.rejects(db.query(`update public.round_announcements set public_link_url = '//evil.test' where round_number = 2`), /check constraint/)
await assert.rejects(db.query(`update public.round_announcements set ends_at = starts_at where round_number = 2`), /check constraint/)
await assert.rejects(db.query(`update public.round_announcements set round_number = 7 where round_number = 2`), /check constraint/)
await db.exec("set test.admin = 'false'")
assert.equal((await db.query('delete from public.round_announcements returning *')).rows.length, 0)
await db.close()
console.log('Migration executed successfully. Verified public reads, hidden drafts, admin-only edits, URL and schedule constraints, and multi-area schedule aggregation in local Postgres.')
