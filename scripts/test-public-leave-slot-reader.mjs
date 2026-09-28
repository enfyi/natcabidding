import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260928200220_public_leave_slot_schedule.sql", import.meta.url),
  "utf8"
);
const source = fs.readFileSync(new URL("../bidding.js", import.meta.url), "utf8");

assert.match(migration, /returns jsonb/i, "leave-slot reader must return one JSON payload");
assert.match(migration, /jsonb_agg/i, "leave-slot reader must aggregate every calendar day");
assert.match(migration, /leave_slot_capacities/i, "saved capacity overrides must be part of the schedule");
assert.match(migration, /grant execute[^;]+to anon, authenticated/i, "leave-slot reader must work while signed out");
assert.match(source, /client\.rpc\("read_public_leave_slots"/);
assert.doesNotMatch(source, /client\.from\("leave_slots"\)\.select/);
assert.match(source, /function leaveSlotCapacityForDetails[\s\S]+return 0;/);
assert.doesNotMatch(source, /leaveSlotCapacityOverrides/);
assert.match(source, /supabaseState\.placeholdersCleared = false;\s+await loadSupabaseReferenceData\(\);/);

console.log("Leave calendars use the complete Supabase schedule and saved daily capacities.");
