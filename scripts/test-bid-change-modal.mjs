import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../bidding.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260928021500_atomic_member_leave_batch_replacement.sql', import.meta.url), 'utf8');

assert.match(html, /data-bid-change-modal/);
assert.match(html, /Current bid date[\s\S]*New bid date/);
assert.match(css, /\.bid-change-modal-panel/);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.bid-change-modal/);
assert.match(source, /function updateRoundOneBidChangeWeek/);
assert.match(source, /Leave a row blank to keep its current date/);
assert.match(source, /replace_own_leave_request_batch/);
assert.match(migration, /create or replace function public\.replace_own_leave_request_batch/);
assert.match(migration, /perform public\.cancel_own_leave_request/);
assert.match(migration, /select public\.submit_leave_bid_batch/);

console.log('PASS bid date changes use a responsive modal and atomic batch replacement');
