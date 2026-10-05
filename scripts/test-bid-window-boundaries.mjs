import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const builder = await readFile(new URL('../database/bid_window_builder.sql', import.meta.url), 'utf8')
const reminders = await readFile(new URL('../lib/bid-window-reminder-email.ts', import.meta.url), 'utf8')

assert.match(source, /date >= window\.start && date < window\.end/)
assert.doesNotMatch(source, /date >= window\.start && date <= window\.end/)
assert.match(source, /return `\$\{formatCalendarDate\(window\.date\)\} · \$\{bidWindowBuilderClock\(window\.startMinutes\)\}`/)
assert.doesNotMatch(source, /inclusiveEnd/)
assert.match(source, /const window = bidWindowForRankRound\(person\.rank, roundNumber, person\.area\)/)
assert.match(source, /DTEND;TZID=America\/Los_Angeles:\$\{bidWindowIcsDateTime\(window\.end\)\}/)
assert.match(builder, /end_timestamp := start_timestamp \+ make_interval\(mins => requested_window_minutes\)/)
assert.match(builder, /select min\(bw\.opens_at\), max\(bw\.closes_at\)[\s\S]*where bw\.bid_year_id = target_bid_year_id[\s\S]*and bw\.round_number = round_number_value/)
assert.match(reminders, /const windowLabel = `Starts \$\{opensAt\}`/)
assert.match(reminders, /const windowLabel = `30 minutes remaining`/)

console.log('Bid-window boundary and start-time-only display checks passed.')
