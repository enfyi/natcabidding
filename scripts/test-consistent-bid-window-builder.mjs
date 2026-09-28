import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const builder = await readFile(new URL('../database/consistent_bid_window_builder.sql', import.meta.url), 'utf8')

assert.match(html, /data-bid-window-builder-consistent checked/)
assert.match(source, /settings\.keepAreasConsistent \? ZLA_AREAS : \[settings\.area\]/)
assert.match(source, /"generate_consistent_bid_window_schedules"/)
assert.match(source, /areaInput\.disabled = consistentInput\.checked/)
assert.match(builder, /create or replace function public\.generate_consistent_bid_window_schedules/)
assert.match(builder, /area_schedule_date := shared_round_start_date/)
assert.match(builder, /shared_round_start_date := round_last_scheduled_date \+ 1/)
assert.match(builder, /b\.bid_role not in \('ADM', 'NB'\)/)
assert.match(builder, /on conflict \(bid_year_id, bidder_id, round_number\) do update/)

console.log('Consistent all-area bid-window builder checks passed.')
