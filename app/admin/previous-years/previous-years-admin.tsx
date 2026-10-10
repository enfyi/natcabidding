'use client'

import Link from 'next/link'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import ActionStatus from '@/app/components/action-status'
import { ArchivePreviewCards } from './archive-preview'
import { ArchiveBrand } from '@/app/components/archive-brand'
import { ArchiveSheet } from '@/app/components/archive-sheet'
import { getSupabaseEnv, withBasePath } from '@/lib/env'
import { createImportRequestTimeout } from '@/lib/import-timeout'
import { ARCHIVE_BUCKET, ARCHIVE_KINDS, ARCHIVE_MIME, archiveFileError, archiveYearIsValid, type ArchiveDocument, type ArchiveKind, type ArchiveLayout, type ArchivePreview, type ArchiveWebWorkbook } from '@/lib/previous-years'

type Area = { id: string; name: string; code: string }
type Access = 'checking' | 'admin' | 'signed-out' | 'denied' | 'error'
let archiveClient: SupabaseClient | undefined
function browserClient() {
  if (!archiveClient) {
    const { url, publishableKey } = getSupabaseEnv()
    archiveClient = createClient(url, publishableKey)
  }
  return archiveClient
}

export function PreviousYearsAdmin() {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [access, setAccess] = useState<Access>('checking')
  const [areas, setAreas] = useState<Area[]>([])
  const [documents, setDocuments] = useState<ArchiveDocument[]>([])
  const [year, setYear] = useState('2026')
  const [areaId, setAreaId] = useState('')
  const [kind, setKind] = useState<ArchiveKind>('rdo')
  const [layout, setLayout] = useState<ArchiveLayout>('desktop')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ArchivePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const [filterYear, setFilterYear] = useState('all')
  const [filterArea, setFilterArea] = useState('all')
  const [showArchivePreview, setShowArchivePreview] = useState(false)
  const [viewWorkbook, setViewWorkbook] = useState<ArchiveWebWorkbook | null>(null)
  const [viewKind, setViewKind] = useState<ArchiveKind>('rdo')
  const [viewSheet, setViewSheet] = useState(0)
  const [viewMonth, setViewMonth] = useState(0)
  const [replaceApproved, setReplaceApproved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const supabase = browserClient()
    setClient(supabase)
    async function initialize() {
      try {
        const session = await supabase.auth.getSession()
        if (!active) return
        if (!session.data.session) { setAccess('signed-out'); return }
        const result = await supabase.rpc('claim_current_bidder_profile')
        if (!active) return
        if (result.error) throw result.error
        const profile = Array.isArray(result.data) ? result.data[0] : result.data
        if (profile?.role !== 'admin') { setAccess('denied'); return }
        const [areaResult, documentResult] = await Promise.all([
          supabase.from('areas').select('id,name,code').order('display_order'),
          supabase.from('previous_year_documents').select('id,archive_year,area_id,document_kind,file_path,file_name,file_size,sheet_names,layout,published,updated_at').order('archive_year', { ascending: false }).order('area_id').order('document_kind'),
        ])
        if (!active) return
        if (areaResult.error || documentResult.error) throw areaResult.error || documentResult.error
        setAreas(areaResult.data || [])
        setDocuments(documentResult.data || [])
        setAccess('admin')
      } catch (error) {
        if (!active) return
        setStatus(error instanceof Error ? error.message : (error as { message?: string })?.message || 'The archive could not be loaded.')
        setFailed(true)
        setAccess('error')
      }
    }
    void initialize()
    return () => { active = false }
  }, [])

  function resetPreview() { setPreview(null); setStatus(''); setFailed(false); setReplaceApproved(false) }
  function showError(error: unknown) {
    setFailed(true)
    setStatus(error instanceof Error ? error.message : (error as { message?: string })?.message || 'The archive operation failed. Try again.')
  }
  async function reload() {
    if (!client) return
    const result = await client.from('previous_year_documents').select('id,archive_year,area_id,document_kind,file_path,file_name,file_size,sheet_names,layout,published,updated_at').order('archive_year', { ascending: false }).order('area_id').order('document_kind')
    if (result.error) throw result.error
    setDocuments(result.data || [])
  }

  const selectedArea = areas.find((area) => area.id === areaId)
  const existing = documents.find((entry) => entry.archive_year === Number(year) && entry.area_id === areaId && entry.document_kind === kind && entry.layout === layout)
  const years = [...new Set(documents.map((entry) => entry.archive_year))].sort((a, b) => b - a)
  const filtered = documents.filter((entry) => (filterYear === 'all' || String(entry.archive_year) === filterYear) && (filterArea === 'all' || entry.area_id === filterArea))

  async function previewFile(event: FormEvent) {
    event.preventDefault()
    if (!client || !file || busy) return
    setPreview(null)
    setFailed(false)
    if (!archiveYearIsValid(Number(year)) || !selectedArea) { showError(new Error('Choose a year from 2000–2100 and an area.')); return }
    const fileError = archiveFileError(file)
    if (fileError) { showError(new Error(fileError)); return }
    setBusy(true)
    setStatus('Reading the workbook…')
    const timeout = createImportRequestTimeout()
    try {
      const session = await client.auth.getSession()
      if (!session.data.session) throw new Error('Sign in again before importing.')
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(withBasePath('/api/admin/previous-years/preview'), {
        method: 'POST', headers: { Authorization: `Bearer ${session.data.session.access_token}` }, body: form, signal: timeout.signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The workbook could not be read.')
      setPreview(result)
      setStatus('Workbook ready. Check the year, area, and worksheet tabs before importing.')
    } catch (error) { showError(error) }
    finally { timeout.clear(); setBusy(false) }
  }

  async function importWorkbook() {
    if (!client || !file || !preview || busy || !selectedArea || !archiveYearIsValid(Number(year))) return
    if (existing && !replaceApproved) return
    setBusy(true)
    setFailed(false)
    setStatus('Importing the Excel workbook…')
    const path = `${year}/${areaId}/${kind}/${crypto.randomUUID()}.xlsx`
    let uploaded = false
    let saved = false
    try {
      const upload = await client.storage.from(ARCHIVE_BUCKET).upload(path, file, { contentType: ARCHIVE_MIME, upsert: false })
      if (upload.error) throw upload.error
      uploaded = true
      const values = {
        archive_year: Number(year), area_id: areaId, document_kind: kind, layout,
        file_path: path, file_name: file.name, file_size: file.size,
        sheet_names: preview.sheets.map((sheet) => sheet.name), rendered_workbook: preview.workbook, published: false,
      }
      // Insert rather than upsert: a concurrent import must not silently overwrite another admin's work.
      const result = existing
        ? await client.from('previous_year_documents').update(values).eq('id', existing.id).eq('updated_at', existing.updated_at).select('id').single()
        : await client.from('previous_year_documents').insert(values).select('id').single()
      if (result.error) throw new Error(result.error.code === '23505' || result.error.code === 'PGRST116'
        ? 'Another administrator changed this archive. Refresh the page before importing again.' : result.error.message)
      saved = true
      // The committed row is authoritative; a cleanup failure must not undo a successful import.
      let cleanupWarning = ''
      if (existing) {
        const cleanup = await client.storage.from(ARCHIVE_BUCKET).remove([existing.file_path])
        if (cleanup.error) cleanupWarning = ' The previous file could not be cleaned up, but is no longer publicly accessible.'
      }
      setPreview(null)
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await reload()
      setStatus(`Imported ${year} ${selectedArea.name} ${ARCHIVE_KINDS[kind]} (${layout}) as a draft. Publish it below when ready.${cleanupWarning}`)
    } catch (error) {
      if (uploaded && !saved) await client.storage.from(ARCHIVE_BUCKET).remove([path]).catch(() => undefined)
      showError(error)
    } finally { setBusy(false) }
  }

  async function togglePublished(entry: ArchiveDocument) {
    if (!client || busy) return
    setBusy(true)
    setFailed(false)
    setStatus(entry.published ? 'Unpublishing workbook…' : 'Publishing workbook…')
    try {
      const result = await client.from('previous_year_documents').update({ published: !entry.published }).eq('id', entry.id).eq('updated_at', entry.updated_at).select('id').single()
      if (result.error) throw new Error(result.error.code === 'PGRST116' ? 'This archive changed. Refresh before publishing.' : result.error.message)
      await reload()
      setStatus(entry.published ? 'Workbook unpublished.' : 'Workbook published in Previous Years.')
    } catch (error) { showError(error) }
    finally { setBusy(false) }
  }

  async function view(entry: ArchiveDocument) {
    if (!client || busy) return
    setBusy(true); setFailed(false)
    try {
      const result = await client.from('previous_year_documents').select('rendered_workbook').eq('id', entry.id).single()
      if (result.error) throw result.error
      if (!result.data.rendered_workbook) throw new Error('Reimport this workbook to create its web version.')
      setViewWorkbook(result.data.rendered_workbook); setViewKind(entry.document_kind); setViewSheet(0); setViewMonth(0)
    } catch (error) { showError(error) }
    finally { setBusy(false) }
  }

  async function download(entry: ArchiveDocument) {
    if (!client || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await client.storage.from(ARCHIVE_BUCKET).createSignedUrl(entry.file_path, 60, { download: entry.file_name })
      if (result.error) throw result.error
      window.location.assign(result.data.signedUrl)
    } catch (error) { showError(error) }
    finally { setBusy(false) }
  }

  const nav = <nav className="import-nav"><Link className="brand" aria-label="ZLA Bidding" href="/bidding.html"><ArchiveBrand /></Link><Link href="/bidding.html?page=admin">Back to Admin Console</Link></nav>
  if (access !== 'admin') return <main className="import-shell">{nav}<section className="import-card archive-access"><p className="eyebrow">Previous Years administration</p><h1>Previous Years</h1><p className="muted">{access === 'checking' ? 'Checking administrator access…' : access === 'signed-out' ? 'Sign in through the bidding site to manage previous years.' : access === 'denied' ? 'Only system administrators can import and publish historical workbooks.' : 'The archive is unavailable. Confirm the Previous Years database migration is installed, then retry.'}</p>{status && <p role="alert">{status}</p>}<Link className="button secondary" href="/bidding.html">Return to bidding site</Link></section></main>

  return <main className="import-shell archive-admin-shell">
    {nav}
    <header className="import-hero"><div><p className="eyebrow">Historical bidding records</p><h1>Previous Years</h1><p className="import-lede">Import each area’s Excel workbooks, then publish them in the public archive.</p></div><div className="archive-row-actions"><button className="button secondary" type="button" aria-expanded={showArchivePreview} aria-controls="archive-draft-preview" onClick={() => setShowArchivePreview(!showArchivePreview)}>{showArchivePreview ? 'Hide Preview' : 'Preview Before Publishing'}</button><Link className="button secondary" href="/bidding.html?area=Previous%20Years">View public archive</Link></div></header>
    <ActionStatus message={status} busy={busy} className={`import-status ${failed ? 'error' : ''}`} />
    {showArchivePreview && <section id="archive-draft-preview" className="import-card archive-draft-preview" aria-label="Draft public archive preview"><p className="archive-preview-label">Admin preview · drafts included · only published files appear publicly</p><ArchivePreviewCards documents={filtered} areas={areas} busy={busy} onView={(entry) => void view(entry)} /></section>}
    {viewWorkbook && <section className="import-card" aria-label="Saved page preview"><div className="archive-row-actions"><h2>Page preview · {ARCHIVE_KINDS[viewKind]}</h2><button className="button secondary" onClick={() => setViewWorkbook(null)}>Close preview</button></div><label>Worksheet<select value={viewSheet} onChange={(event) => { setViewSheet(Number(event.target.value)); setViewMonth(0) }}>{viewWorkbook.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>)}</select></label>{viewKind === 'leave' && viewWorkbook.sheets[viewSheet]?.months.length > 0 && <label>Month<select value={viewMonth} onChange={(event) => setViewMonth(Number(event.target.value))}>{viewWorkbook.sheets[viewSheet].months.map((month, index) => <option key={index} value={index}>{month.label}</option>)}</select></label>}<ArchiveSheet sheet={viewWorkbook.sheets[viewSheet]} calendar={viewKind === 'leave'} month={viewMonth} /></section>}
    <section className="import-card" aria-labelledby="archive-import-heading">
      <div className="import-section-heading"><div><span>1</span><div><h2 id="archive-import-heading">Add previous year</h2><p>Upload desktop and mobile workbooks separately for the same area and document type.</p></div></div></div>
      <form onSubmit={(event) => void previewFile(event)}>
        <fieldset className="archive-fields" disabled={busy}>
          <div className="import-field-grid archive-import-fields">
            <label>Year<input type="number" min="2000" max="2100" required value={year} onChange={(event) => { setYear(event.target.value); resetPreview() }} /></label>
            <label>Area<select required value={areaId} onChange={(event) => { setAreaId(event.target.value); resetPreview() }}><option value="">Choose area</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
            <label>Document type<select value={kind} onChange={(event) => { setKind(event.target.value as ArchiveKind); resetPreview() }}>{Object.entries(ARCHIVE_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Layout<select value={layout} onChange={(event) => { setLayout(event.target.value as ArchiveLayout); resetPreview() }}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
            <label>Excel workbook<input ref={fileInput} type="file" accept=".xlsx" required onChange={(event) => { setFile(event.target.files?.[0] || null); resetPreview() }} /><small>Google Sheets → File → Download → Microsoft Excel (.xlsx). Up to 4 MB.</small></label>
          </div>
          <p className="import-safety-note">The workbook is converted once into a read-only web page. The original Excel file is retained for administrators. Imports are saved as drafts and do not change active bidding data.</p>
          {existing && <p className="archive-replace-note">A {year} {selectedArea?.name} {ARCHIVE_KINDS[kind]} {layout} workbook already exists. Importing will replace it and return it to draft.</p>}
          <button className="button secondary" type="submit" disabled={!file || !areaId || !year}>Preview Excel</button>
        </fieldset>
      </form>
      {preview && <section className="archive-preview" aria-label="Workbook import preview">
        <h3>{year} · {selectedArea?.name} · {ARCHIVE_KINDS[kind]} · {layout === 'mobile' ? 'Mobile' : 'Desktop'}</h3>
        <p>{file?.name} · {preview.sheets.length} worksheet {preview.sheets.length === 1 ? 'tab' : 'tabs'}</p>
        <p className="muted">This is the saved web version visitors will see. Conversion happens once during import.</p>
        {preview.workbook.sheets.map((sheet, index) => <details key={index} open={index === 0}><summary>{sheet.name}</summary><ArchiveSheet sheet={sheet} calendar={kind === 'leave'} /></details>)}
        {existing && <label className="archive-replace-confirm"><input type="checkbox" checked={replaceApproved} disabled={busy} onChange={(event) => setReplaceApproved(event.target.checked)} />Replace the existing workbook and save the replacement as a draft.</label>}
        <div className="import-actions"><button className="button primary" type="button" disabled={busy || Boolean(existing && !replaceApproved)} onClick={() => void importWorkbook()}>{busy ? 'Working…' : existing ? 'Replace Excel as Draft' : 'Import Excel as Draft'}</button></div>
      </section>}
    </section>
    <section className="import-card archive-list" aria-labelledby="archive-list-heading">
      <div className="import-section-heading"><div><span>2</span><div><h2 id="archive-list-heading">Manage previous years</h2><p>{documents.filter((entry) => entry.published).length} published · {documents.filter((entry) => !entry.published).length} drafts</p></div></div></div>
      <div className="import-field-grid archive-filter-fields"><label>Filter year<select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}><option value="all">All years</option>{years.map((value) => <option key={value}>{value}</option>)}</select></label><label>Filter area<select value={filterArea} onChange={(event) => setFilterArea(event.target.value)}><option value="all">All areas</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label></div>
      <div className="archive-document-list">{filtered.map((entry) => <article className="archive-document-row" key={entry.id}><div><span className={`archive-badge ${entry.published ? 'published' : ''}`}>{entry.published ? 'Published' : 'Draft'}</span><h3>{entry.archive_year} · {areas.find((area) => area.id === entry.area_id)?.name} · {ARCHIVE_KINDS[entry.document_kind]} · {entry.layout === 'mobile' ? 'Mobile' : 'Desktop'}</h3><p>{entry.file_name} · {Math.ceil(entry.file_size / 1024)} KB</p><p className="muted">Tabs: {entry.sheet_names.join(', ')}</p></div><div className="archive-row-actions"><button className="button secondary" disabled={busy} onClick={() => void view(entry)}>Preview Page</button><button className="button secondary" disabled={busy} onClick={() => void download(entry)}>Original Excel</button><button className="button secondary" disabled={busy} onClick={() => { setYear(String(entry.archive_year)); setAreaId(entry.area_id); setKind(entry.document_kind); setLayout(entry.layout); setFile(null); resetPreview(); if (fileInput.current) { fileInput.current.value = ''; fileInput.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); fileInput.current.focus() } }}>Replace Excel</button><button className={`button ${entry.published ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => void togglePublished(entry)}>{entry.published ? 'Unpublish' : 'Publish'}</button></div></article>)}</div>
      {!filtered.length && <p className="muted">{documents.length ? 'No workbooks match these filters.' : 'No previous years imported yet. Choose a year, area, and Excel workbook above to get started.'}</p>}
    </section>
  </main>
}
