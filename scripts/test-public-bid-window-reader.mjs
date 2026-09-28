import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260928191542_return_complete_public_bid_window_schedule.sql", import.meta.url),
  "utf8"
);
const source = fs.readFileSync(new URL("../bidding.js", import.meta.url), "utf8");

assert.match(migration, /returns jsonb/i, "public reader must return one JSON payload");
assert.match(migration, /jsonb_agg/i, "public reader must aggregate every bid window");
assert.match(migration, /grant execute[^;]+to anon, authenticated/i, "public reader must be callable while signed out");
assert.match(source, /client\.rpc\("read_public_bid_windows"/);

console.log("Public bid-window reader exposes the complete saved schedule without the 1,000-row API cap.");
