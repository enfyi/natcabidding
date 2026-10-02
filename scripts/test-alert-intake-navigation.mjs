import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../bidding.html', import.meta.url), 'utf8')

assert.match(source, /intakeItemId: item\.id/)
assert.match(source, /data-intake-item=/)
assert.match(source, /function openIntakeItemFromAlert\(itemId\)/)
assert.match(source, /item\.members\?\.some\(\(member\) => member\.id === itemId\)/)
assert.match(source, /activeIntakeDetailId = groupedItem\.id/)
assert.match(source, /alertFocusedIntakeItemId = groupedItem\.id/)
assert.match(source, /filteredItems\.unshift\(filteredItems\.splice\(focusedIndex, 1\)\[0\]\)/)
assert.match(source, /openIntakeItemFromAlert\(alertItem\.dataset\.intakeItem\)/)
assert.match(source, /card\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\)/)
assert.match(html, /bidding\.js\?v=[^"\s]+-alert-review-focus/)

console.log('Alert intake navigation regression checks passed.')
