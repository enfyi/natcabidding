import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const start = source.indexOf('function renderPublicFaq()')
const end = source.indexOf('\nfunction bidAsClass', start)
const content = { entries: [], documents: [] }
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const context = vm.createContext({
  publicFaqContent: content,
  supabaseState: { faqLoadState: 'loaded' },
  escapeHtml: escape, escapeAttribute: escape, richTextMarkup: escape,
})
vm.runInContext(source.slice(start, end), context)
const render = () => vm.runInContext('renderPublicFaq()', context)
assert.match(render(), /No FAQ items or MOU documents/)
content.documents = [
  { title: 'Facility MOU', file_path: 'mous/facility.pdf', file_url: 'https://example.com/facility.pdf' },
  { title: 'Area A MOU', file_path: 'mous/areas/a.pdf', file_url: 'https://example.com/a.pdf' },
  { title: 'Area B <MOU>', file_path: 'mous/areas/b.pdf', file_url: 'https://example.com/b.pdf' },
]
const html = render()
assert.equal((html.match(/id="public-area-mou-heading"/g) || []).length, 1)
const areaStart = html.indexOf('id="public-area-mou-heading"')
assert.ok(html.indexOf('public-faq-heading') < areaStart)
assert.ok(html.indexOf('id="public-mou-heading"') < areaStart)
assert.ok(html.indexOf('Facility MOU') < areaStart)
assert.match(html, /public-area-mou-list/)
assert.ok(html.indexOf('Area A MOU') > areaStart)
assert.ok(html.indexOf('Area B &lt;MOU>') > areaStart)
assert.equal((html.match(/https:\/\/example.com\/a.pdf/g) || []).length, 1)
content.documents = [{ title: 'Legacy MOU', file_url: 'https://example.com/legacy.pdf' }]
assert.match(render(), /Legacy MOU/)
assert.doesNotMatch(render(), /public-area-mou-heading/)
console.log('Area MOU grouping, links, escaping, and legacy documents passed.')

const admin = await readFile(new URL('../app/admin/faq/faq-admin.tsx', import.meta.url), 'utf8')
const uploadCode = admin.slice(admin.indexOf('  async function addDocument('), admin.indexOf('  async function updateDocument(')).replace('querySelector<HTMLInputElement>', 'querySelector')
for (const insertFails of [false, true]) {
  const uploads = [], inserts = [], removals = []
  const file = { name: 'area-a.pdf' }
  let status = '', reloaded = false
  const storage = {
    upload: async (...args) => { uploads.push(args); return {} },
    getPublicUrl: path => ({ data: { publicUrl: `https://example.com/${path}` } }),
    remove: async paths => { removals.push(paths); return {} },
  }
  const uploadContext = vm.createContext({
    supabase: { storage: { from: () => storage }, from: () => ({ insert: async row => { inserts.push(row); return { error: insertFails ? { message: 'Insert failed' } : null } } }) },
    areaName: 'Area A', areaFile: file, docTitle: '', docDescription: '', docFile: null,
    documents: [], AREA_MOU_PREFIX: 'mous/areas/', MOU_BUCKET: 'mou-documents',
    crypto: { randomUUID: () => 'unique' }, slugFileName: name => name,
    normalizedRichHtml: value => value, nextOrder: () => 10,
    setStatus: value => { status = value }, setBusy() {}, setAreaName() {}, setAreaFile() {},
    document: { querySelector: () => ({ value: 'chosen' }) },
    loadContent: async () => { reloaded = true },
  })
  vm.runInContext(uploadCode, uploadContext)
  await vm.runInContext('addDocument(true)', uploadContext)
  assert.equal(uploads[0][0], 'mous/areas/unique-area-a.pdf')
  assert.equal(uploads[0][1], file)
  assert.equal(inserts[0].title, 'Area A MOU')
  assert.equal(inserts[0].published, true)
  assert.equal(reloaded, !insertFails)
  assert.equal(removals.length, insertFails ? 1 : 0)
  assert.equal(status, insertFails ? 'Insert failed' : 'MOU uploaded.')
}
console.log('Area MOU upload, publication, refresh, and failed-save cleanup passed.')
