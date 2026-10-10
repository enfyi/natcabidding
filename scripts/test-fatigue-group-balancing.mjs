import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const start = source.indexOf('const FATIGUE_GROUPS =')
const end = source.indexOf('function isForcedMid', start)
assert.ok(start >= 0 && end > start, 'fatigue balancing source could not be located')

const context = vm.createContext({
  currentUser: { area: 'Area A' },
  selectedLineId: '',
  selectedFatigueGroup: '',
  normalizeBidRoleForArea: (role) => role,
  seniorityEntryActive: (entry) => entry[7] !== false,
  seniorityEntryArea: (entry) => entry[4],
  senioritySource: [],
  rdoLines: [],
})
context.rdoLinesForArea = (area) => context.rdoLines.filter((item) => item.area === area)

vm.runInContext(`${source.slice(start, end)}
this.testApi = { fatigueCapacityForLine };`, context)

const cpcRosterEntry = (index) => [`Last${index}`, `First${index}`, 'CPC', `C${index}`, 'Area A', '', '', true]
const devRosterEntry = (index) => [`DevLast${index}`, `DevFirst${index}`, index % 2 ? 'R-DEV' : 'D-DEV', `D${index}`, 'Area A', '', '', true]
const line = (code, pattern, group = '', status = 'Open', lineType = 'CPC', week = ['RDO', 'RDO', '', '', '', '', '']) => ({
  area: 'Area A', line: String(code), pattern, group, status, lineType, week,
})

context.senioritySource.push(...Array.from({ length: 31 }, (_, index) => cpcRosterEntry(index)))
context.rdoLines.push(
  ...Array.from({ length: 6 }, (_, index) => line(index + 1, 'S/S')),
  ...Array.from({ length: 4 }, (_, index) => line(index + 7, 'S/M')),
  ...Array.from({ length: 21 }, (_, index) => line(index + 11, `OTHER-${index}`)),
)

let capacity = context.testApi.fatigueCapacityForLine(context.rdoLines[0], null, '')
assert.deepEqual(Array.from(capacity, (item) => item.areaMax), [11, 11, 11])
assert.deepEqual(Array.from(capacity, (item) => item.crewMax), [2, 2, 2])

context.rdoLines[6].status = 'Taken'
context.rdoLines[6].group = 'A'
context.rdoLines[7].status = 'Taken'
context.rdoLines[7].group = 'A'
capacity = context.testApi.fatigueCapacityForLine(context.rdoLines[8], null, '')
assert.deepEqual(Array.from(capacity, (item) => item.crewMax), [2, 1, 1])
assert.equal(capacity.find((item) => item.group === 'A').available, false)
assert.equal(capacity.find((item) => item.group === 'B').available, true)

// A four-line crew at 1/2 must permit the second assignment. Once A claims
// the remainder, B and C have one slot each; the area still has ample space.
context.rdoLines[7].status = 'Open'
context.rdoLines[7].group = ''
capacity = context.testApi.fatigueCapacityForLine(context.rdoLines[8], null, '')
assert.equal(capacity.find((item) => item.group === 'A').crewUsed, 1)
assert.equal(capacity.find((item) => item.group === 'A').crewMax, 2)
assert.equal(capacity.find((item) => item.group === 'A').available, true)
context.rdoLines[7].status = 'Taken'
context.rdoLines[7].group = 'A'

context.rdoLines.slice(10, 21).forEach((item) => {
  item.status = 'Taken'
  item.group = 'A'
})
capacity = context.testApi.fatigueCapacityForLine(context.rdoLines[21], null, '')
assert.deepEqual(Array.from(capacity, (item) => item.areaMax), [11, 10, 10])
assert.equal(capacity.find((item) => item.group === 'A').available, false)

context.senioritySource.splice(0, context.senioritySource.length, ...Array.from({ length: 10 }, (_, index) => devRosterEntry(index)))
context.rdoLines.splice(0, context.rdoLines.length,
  line(1, 'R-DEV', '', 'Open', 'DEV', ['RDO', 'RDO', '', '', '', '', '']),
  line(2, 'D-DEV', '', 'Open', 'DEV', ['RDO', 'RDO', '', '', '', '', '']),
  line(3, 'R-DEV', '', 'Open', 'DEV', ['RDO', 'RDO', '', '', '', '', '']),
  line(4, 'D-DEV', '', 'Open', 'DEV', ['RDO', 'RDO', '', '', '', '', '']),
  ...Array.from({ length: 6 }, (_, index) => line(index + 5, 'R-DEV', '', 'Open', 'DEV', ['', 'RDO', 'RDO', '', '', '', ''])),
)
capacity = context.testApi.fatigueCapacityForLine(context.rdoLines[0], null, '')
assert.deepEqual(Array.from(capacity, (item) => item.areaMax), [4, 4, 4])
assert.deepEqual(Array.from(capacity, (item) => item.crewMax), [2, 2, 2])

// Selecting an approved line must not subtract it from the counters or
// move its saved group to a stale selection. Exercise every area and pool.
for (const area of ['Area A', 'Area B', 'Area C', 'Area D', 'Area E', 'Area F', 'TMU']) {
  for (const pool of ['CPC', 'DEV']) {
    context.senioritySource.splice(0)
    context.rdoLines.splice(0, context.rdoLines.length,
      ...Array.from({ length: 8 }, (_, index) => ({ ...line(index + 1, pool === 'CPC' ? 'S/S' : 'R-DEV', 'B', 'Taken', pool), area })),
      { ...line(9, pool === 'CPC' ? 'S/S' : 'D-DEV', 'A', 'Open', pool), area },
      { ...line(10, 'S/S', 'B', 'Taken', pool === 'CPC' ? 'DEV' : 'CPC'), area },
    )
    const selected = context.rdoLines[0]
    for (const preference of ['', 'A', 'B', 'C', 'No preference']) {
      capacity = context.testApi.fatigueCapacityForLine(selected, selected.line, preference)
      assert.deepEqual(Array.from(capacity, (item) => item.areaUsed), [0, 8, 0], `${area} ${pool} approved totals`)
      assert.deepEqual(Array.from(capacity, (item) => item.crewUsed), [0, 8, 0], `${area} ${pool} approved RDO totals`)
    }
    capacity = context.testApi.fatigueCapacityForLine(context.rdoLines[8], '9', 'A')
    assert.deepEqual(Array.from(capacity, (item) => item.areaUsed), [1, 8, 0], 'open candidate preview remains included')
  }
}

console.log('PASS fatigue groups balance CPC and DEV pools by area and RDO set; approved counters include selected lines in every area')
