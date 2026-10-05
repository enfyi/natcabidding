import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
let resolveBackup
let calls = 0
const elements = new Map([
  ['[data-backup-status]', {}], ['[data-backup-latest]', {}], ['[data-backup-download]', {}],
])
const client = {
  rpc(name) {
    assert.equal(name, 'backup_bidding_now')
    calls++
    return new Promise(resolve => { resolveBackup = resolve })
  },
  from() { return { select() { return { order() { return { limit: async () => ({ data: [{ id: 1, created_at: '2026-10-05T18:00:00Z', source: 'manual' }] }) } } } } } },
}
const context = vm.createContext({
  document: { querySelector: selector => elements.get(selector), querySelectorAll: () => [], addEventListener() {} },
  hasSystemAdminAccess: () => true, supabaseClient: () => client,
  setTimeout, Date, console,
})
vm.runInContext('let biddingBackupBusy = false;\n' + source.slice(source.indexOf('function backupStatus(message)')), context)
const run = () => vm.runInContext("performBiddingBackupAction('now')", context)
const first = run()
assert.equal(calls, 1, 'The click starts the database backup immediately')
assert.match(elements.get('[data-backup-status]').textContent, /Backing up now/)
await run()
assert.equal(calls, 1, 'Repeated clicks cannot start concurrent backups')
resolveBackup({ data: 1 })
await first
assert.equal(elements.get('[data-backup-status]').textContent, 'Backup completed and saved.')
const failed = run()
resolveBackup({ error: { message: 'Backup failed' } })
await failed
assert.equal(elements.get('[data-backup-status]').textContent, 'Backup failed')
console.log('Immediate backup, duplicate click, completion, and failure checks passed.')

let saved
const fields = { enabled: { checked: false } }
const form = { elements: { namedItem: name => fields[name] } }
elements.set('[data-backup-form]', form)
let retention = '7'
context.FormData = class {
  constructor() { return new Map(Object.entries({ start_date: '2026-10-05', end_date: '2026-10-10', start_time: '07:00', end_time: '17:00', interval_minutes: '30', retention_days: retention })) }
}
client.from = () => ({
  upsert: async value => { saved = value; return {} },
  select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
})
await vm.runInContext("performBiddingBackupAction('save')", context)
assert.equal(saved.retention_days, 7)
assert.equal(saved.enabled, false, 'Retention is saved even when automatic capture is disabled')
retention = ''
await vm.runInContext("performBiddingBackupAction('save')", context)
assert.equal(saved.retention_days, null, 'Blank days keeps all backups')
for (retention of ['0', '-1', '1.5', 'abc', '36501']) {
  saved = null
  await vm.runInContext("performBiddingBackupAction('save')", context)
  assert.equal(saved, null, 'Invalid retention must not be saved')
  assert.match(elements.get('[data-backup-status]').textContent, /whole number/)
}
console.log('Retention saving, disabling, and invalid-day checks passed.')
