import assert from 'node:assert/strict'
import { activeAnnouncements, announcementWindow, announcementTitle, defaultAnnouncement, fromLocalInput, safeAnnouncementUrl, toLocalInput } from '../round-announcements.mjs'

const schedule = [
  { round_number: 1, starts_at: '2026-10-01T15:00:00Z', ends_at: '2026-10-15T23:00:00Z' },
  { round_number: 2, starts_at: '2026-10-16T15:00:00Z', ends_at: '2026-10-22T23:00:00Z' },
  { round_number: 3, starts_at: '2026-10-23T15:00:00Z', ends_at: '2026-10-29T23:00:00Z' },
]
const item = { ...defaultAnnouncement(2, 2027), enabled: true }
const bounds = announcementWindow(item, schedule)
assert.deepEqual(bounds, { start: Date.parse(schedule[0].ends_at), end: Date.parse(schedule[1].starts_at) })
for (const [now, visible] of [[bounds.start - 1, false], [bounds.start, true], [bounds.end - 1, true], [bounds.end, false]]) {
  assert.equal(activeAnnouncements([item], schedule, now).length, Number(visible))
}
assert.equal(activeAnnouncements([{ ...item, enabled: false }], schedule, bounds.start).length, 0)
assert.equal(announcementWindow(item, []), null, 'Missing schedules must not invent dates')
assert.equal(announcementWindow(item, [{ ...schedule[0], ends_at: schedule[1].starts_at }, schedule[1]]), null, 'No gap means no announcement')
assert.equal(announcementWindow({ ...item, round_number: 1 }, schedule), null)
assert.ok(announcementWindow({ ...item, round_number: 1, starts_at: '2026-09-30T15:00:00Z' }, schedule))
const manual = { ...item, mode: 'manual', starts_at: '2026-10-14T15:00:00Z', ends_at: '2026-10-17T15:00:00Z' }
assert.ok(announcementWindow(manual, []), 'Manual dates work independently of published times')
assert.equal(announcementWindow({ ...manual, ends_at: manual.starts_at }, schedule), null)
assert.match(announcementTitle(item, schedule, Date.parse('2026-10-15T23:00:00Z')), /tomorrow, October 16/)
assert.match(announcementTitle(item, schedule, Date.parse('2026-10-16T08:00:00Z')), /today, October 16/)
assert.match(announcementTitle(item, schedule, Date.parse('2026-10-14T23:00:00Z')), /on October 16/)
assert.equal(announcementTitle({ ...item, title: 'Custom wording for round {round}' }, schedule), 'Custom wording for round 2')
assert.equal(announcementWindow(item, [schedule[0], { ...schedule[1], starts_at: '2026-10-17T15:00:00Z' }]).end, Date.parse('2026-10-17T15:00:00Z'))
for (let round = 1; round <= 6; round++) assert.equal(defaultAnnouncement(round, 2028).round_number, round)
for (const value of ['login', '/bidding/login', 'bidding.html?page=seniority', '#bid-times', 'https://example.com/times', 'http://localhost:3000/login']) assert.ok(safeAnnouncementUrl(value), value)
for (const value of ['javascript:alert(1)', 'data:text/html,hi', '//evil.test', '\\evil.test', ' javascript:alert(1)', 'java\nscript:alert(1)', 'https://', 'https://example.com/\n', '']) assert.equal(safeAnnouncementUrl(value), false, value)
assert.equal(fromLocalInput('2026-10-16T08:00'), '2026-10-16T15:00:00.000Z')
assert.equal(fromLocalInput('2026-12-16T08:00'), '2026-12-16T16:00:00.000Z')
assert.equal(toLocalInput('2026-10-16T15:00:00Z'), '2026-10-16T08:00')
assert.throws(() => fromLocalInput('2027-03-14T02:30'), /daylight saving/)
assert.equal(fromLocalInput(''), null)
console.log('Round announcements: timing boundaries, schedule changes, all rounds, wording, URL safety, and Los Angeles time checks passed.')

// Exercise the website renderer with the same settings and helpers used by the editor.
const { readFile } = await import('node:fs/promises')
const vm = await import('node:vm')
const helpers = await import('../round-announcements.mjs')
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const renderSource = source.slice(source.indexOf('function renderRoundAnnouncements()'), source.indexOf('async function refreshRoundAnnouncements()'))
function element(tag) {
  return { tag, children: [], attributes: {}, append(...children) { this.children.push(...children) }, setAttribute(name, value) { this.attributes[name] = value }, replaceChildren(...children) { this.children = children } }
}
const publicContainer = { ...element('div'), dataset: { roundAnnouncements: 'public' } }
const memberContainer = { ...element('div'), dataset: { roundAnnouncements: 'member' } }
let now = bounds.start
let scheduledDelay = null
const context = vm.createContext({
  BID_YEAR: 2027,
  roundAnnouncementState: { items: [{ ...item, color: 'blue', body: '<script>literal text</script>', public_link_url: 'login', member_link_url: 'bidding.html?page=seniority' }], schedule, year: 2027 },
  roundAnnouncementHelpers: helpers,
  roundAnnouncementTimer: null,
  Date: { now: () => now },
  clearTimeout() {},
  setTimeout(_callback, delay) { scheduledDelay = delay },
  document: { querySelectorAll: () => [publicContainer, memberContainer], createElement: element },
})
vm.runInContext(renderSource, context)
context.renderRoundAnnouncements()
assert.equal(publicContainer.children.length, 1)
assert.equal(memberContainer.children.length, 1)
assert.match(publicContainer.children[0].className, /round-announcement-blue/)
assert.equal(publicContainer.children[0].children[1].children[1].textContent, '<script>literal text</script>')
assert.equal(publicContainer.children[0].children[2].href, 'login')
assert.equal(memberContainer.children[0].children[2].href, 'bidding.html?page=seniority')
assert.equal(scheduledDelay, bounds.end - bounds.start)
context.BID_YEAR = 2026
context.renderRoundAnnouncements()
assert.equal(publicContainer.children.length, 0, 'Never show active-year announcements in an archived year')
context.BID_YEAR = 2027
now = bounds.end
context.renderRoundAnnouncements()
assert.equal(memberContainer.children.length, 0, 'Remove announcement at the selected round start')
console.log('Public and dashboard rendering, editable links, text escaping, colors, archived years, and exact removal timer checks passed.')

now = bounds.start
context.roundAnnouncementState.items[0] = { ...item, title: '   ', public_link_label: '', member_link_label: '   ', public_link_url: '', member_link_url: '' }
context.renderRoundAnnouncements()
for (const container of [publicContainer, memberContainer]) {
  const banner = container.children[0]
  assert.equal(banner.children.length, 2, 'Blank labels omit the whole link, including its arrow')
  assert.equal(banner.children[1].children.length, 1, 'Blank headings omit the heading element')
  assert.equal(banner.children[1].children[0].tag, 'span', 'Message remains visible')
}
context.roundAnnouncementState.items[0].member_link_label = 'My bid time'
context.roundAnnouncementState.items[0].member_link_url = 'bidding.html?page=seniority'
context.renderRoundAnnouncements()
assert.equal(publicContainer.children[0].children.length, 2)
assert.equal(memberContainer.children[0].children.length, 3, 'Link labels are optional independently on each surface')
console.log('Optional heading and independent public/dashboard link label checks passed.')
