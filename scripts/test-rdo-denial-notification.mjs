import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const extract = (name) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1))
const notices = [{ hidden: true, textContent: '' }, { hidden: true, textContent: '' }]
const context = vm.createContext({
  currentUser: { initials: 'AB', area: 'Area A' },
  intakeQueue: [],
  document: { querySelectorAll: () => notices },
})
vm.runInContext(extract('latestCurrentUserDeniedRdoRequest') + '\n' + extract('renderLatestRdoDenialReason'), context)
const denied = { type: 'RDO Line', initials: 'AB', area: 'Area A', status: 'Denied', isChange: true, line: '12', denialReason: 'Line unavailable.' }
context.intakeQueue = [{ ...denied, area: 'Area B' }, denied, { ...denied, status: 'Approved' }]
vm.runInContext('renderLatestRdoDenialReason()', context)
for (const notice of notices) {
  assert.equal(notice.hidden, false)
  assert.match(notice.textContent, /change request for Line 12 has been denied/)
  assert.match(notice.textContent, /Line unavailable/)
  assert.match(notice.textContent, /bid window is open/)
}
for (const status of ['Pending', 'Approved']) {
  context.intakeQueue.unshift({ ...denied, status })
  vm.runInContext('renderLatestRdoDenialReason()', context)
  assert.equal(notices[0].hidden, true)
  assert.equal(notices[0].textContent, '')
}
context.intakeQueue = [{ ...denied, denialReason: '' }]
vm.runInContext('renderLatestRdoDenialReason()', context)
assert.match(notices[0].textContent, /Contact the Bidding Office/)
console.log('PASS RDO denial notices show reasons and clear after a replacement bid')
