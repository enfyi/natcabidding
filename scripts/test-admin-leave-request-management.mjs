// Local-only Postgres regression test. Set PGLITE_MODULE to an installed PGlite
// module path, or make @electric-sql/pglite available to Node.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = fs.readFileSync(`${root}/bidding.js`, "utf8");
const migration = fs.readFileSync(`${root}/database/admin_leave_request_management.sql`, "utf8");
const db = new PGlite();
const id = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, "0")}`;

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email', current_setting('test.email', true))$$;
`);
await db.exec(fs.readFileSync(`${root}/database/schema.sql`, "utf8").replace("create extension if not exists pgcrypto;", ""));
await db.exec(migration);

await db.exec(`
  insert into bid_years(id, bid_year) values ('${id(1)}', 2027);
  insert into areas(id, code, name) values
    ('${id(2)}', 'area-a', 'Area A'),
    ('${id(3)}', 'area-b', 'Area B');
  insert into bidders(id, auth_user_id, area_id, first_name, last_name, initials, email, role, bid_role) values
    ('${id(10)}', '${id(110)}', '${id(2)}', 'Admin', 'Test', 'AD', 'admin@example.test', 'admin', 'ADM'),
    ('${id(11)}', '${id(111)}', '${id(2)}', 'Bidder', 'Test', 'BT', 'bidder@example.test', 'controller', 'CPC'),
    ('${id(12)}', '${id(112)}', '${id(2)}', 'Intake', 'Test', 'IT', 'intake@example.test', 'intake', 'ADM'),
    ('${id(13)}', '${id(113)}', '${id(3)}', 'Other', 'Area', 'OA', 'other@example.test', 'controller', 'CPC');
  insert into leave_requests(id, bid_year_id, bidder_id, round_number, priority, status, requested_start_date, requested_end_date, charged_days) values
    ('${id(20)}', '${id(1)}', '${id(11)}', 1, 1, 'approved', '2027-06-07', '2027-06-07', 1),
    ('${id(21)}', '${id(1)}', '${id(13)}', 1, 1, 'approved', '2027-07-12', '2027-07-12', 1);
  insert into leave_request_dates(leave_request_id, leave_date, charged) values
    ('${id(20)}', '2027-06-07', true),
    ('${id(21)}', '2027-07-12', true);
  insert into leave_slots(id, bid_year_id, area_id, slot_date, slot_group, slot_code, bidder_id, slot_initials, status, source_leave_request_id) values
    ('${id(30)}', '${id(1)}', '${id(2)}', '2027-06-07', 'cpc', '1', '${id(11)}', 'BT', 'approved', '${id(20)}'),
    ('${id(31)}', '${id(1)}', '${id(2)}', '2027-06-07', 'cpc', 'OVERRIDE-${id(20)}', '${id(11)}', 'BT', 'approved', '${id(20)}'),
    ('${id(32)}', '${id(1)}', '${id(3)}', '2027-07-12', 'cpc', '1', '${id(13)}', 'OA', 'approved', '${id(21)}');
  insert into leave_credit_events(bid_year_id, bidder_id, round_number, credit_date, source, source_leave_request_id) values
    ('${id(1)}', '${id(11)}', 1, '2027-06-07', 'holiday', '${id(20)}');
  insert into intake_submissions(id, bid_year_id, area_id, bidder_id, round_number, leave_request_id, submission_type, status) values
    ('${id(40)}', '${id(1)}', '${id(2)}', '${id(11)}', 1, '${id(20)}', 'leave', 'approved');
  set test.uid = '${id(110)}';
  set test.email = 'admin@example.test';
`);

const result = (await db.query("select public.admin_cancel_leave_requests($1) result", [[id(20)]])).rows[0].result;
assert.equal(result.cancelled_count, 1);
assert.equal((await db.query("select status from leave_requests where id = $1", [id(20)])).rows[0].status, "cancelled");
assert.deepEqual(
  (await db.query("select status, bidder_id, source_leave_request_id from leave_slots where id = $1", [id(30)])).rows[0],
  { status: "open", bidder_id: null, source_leave_request_id: null }
);
assert.equal((await db.query("select count(*)::integer count from leave_slots where id = $1", [id(31)])).rows[0].count, 0);
assert.equal((await db.query("select count(*)::integer count from leave_credit_events where source_leave_request_id = $1", [id(20)])).rows[0].count, 0);
assert.equal((await db.query("select status from intake_submissions where leave_request_id = $1", [id(20)])).rows[0].status, "cancelled");
assert.equal((await db.query("select count(*)::integer count from leave_request_dates where leave_request_id = $1", [id(20)])).rows[0].count, 1);
assert.equal((await db.query("select details->>'history_retained' retained from audit_events where entity_id = $1", [id(20)])).rows[0].retained, "true");

await db.exec(`set test.uid = '${id(111)}'; set test.email = 'bidder@example.test';`);
await assert.rejects(
  () => db.query("select public.admin_cancel_leave_requests($1)", [[id(21)]]),
  /intake or an administrator/
);

await db.exec(`set test.uid = '${id(112)}'; set test.email = 'intake@example.test';`);
await assert.rejects(
  () => db.query("select public.admin_cancel_leave_requests($1)", [[id(21)]]),
  /own area/
);

assert.match(source, /data-intake-manage-leave/);
assert.match(source, /data-intake-remove-leave/);
assert.match(source, /admin_cancel_leave_requests/);
assert.match(source, /Bid history retained/);
assert.match(migration, /security definer[\s\S]*set search_path = ''/);
assert.match(migration, /revoke all on function public\.admin_cancel_leave_requests\(uuid\[\]\)[\s\S]*from public, anon/);

console.log("PASS admin edits grouped leave dates and cancels approved bids while retaining history");
await db.close();
