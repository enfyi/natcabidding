'use client'

import Link from 'next/link'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { getSupabaseEnv } from '@/lib/env'
import { createImportRequestTimeout, importTimeoutMessage } from '@/lib/import-timeout'
import type { RosterImportAction, RosterImportPreview, RosterImportRow } from '@/lib/roster-import-types'

type AccessState = 'checking' | 'admin' | 'signed-out' | 'denied' | 'error'
type ExistingBidder = {
  profile_id: string
  first_name: string
  last_name: string
  initials: string
  email: string | null
  phone: string | null
  bid_role: string
  seniority_rank: number | null
  area_name: string
  active: boolean
}
type PreviewRow = RosterImportRow & { action: RosterImportAction; changes: string[] }
type ImportResult = { rows_processed: number; bidders_added: number; bidders_updated: number; bidders_unchanged: number }

declare global {
  interface Window { __zlaRosterImportSupabase?: SupabaseClient }
}

function browserClient() {
  if (window.__zlaRosterImportSupabase) return window.__zlaRosterImportSupabase
  const { url, publishableKey } = getSupabaseEnv()
  window.__zlaRosterImportSupabase = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return window.__zlaRosterImportSupabase
}

function areaCode(areaName: string) {
  return areaName.toUpperCase().replace(/^AREA\s+/, '')
}

function compareRow(row: RosterImportRow, match: ExistingBidder | null): PreviewRow {
  if (!match) return { ...row, action: 'add', changes: ['New bidder'] }

  const changes: string[] = []
  const compare = (label: string, before: unknown, after: unknown) => {
    if ((before ?? '') !== (after ?? '')) changes.push(`${label}: ${before || 'blank'} → ${after || 'blank'}`)
  }
  compare('Area', areaCode(match.area_name), row.area_code)
  compare('Rank', match.seniority_rank, row.seniority_rank)
  compare('First name', match.first_name, row.first_name)
  compare('Last name', match.last_name, row.last_name)
  compare('Initials', match.initials, row.initials)
  if (row.email) compare('Email', match.email, row.email)
  if (row.phone) compare('Phone', match.phone, row.phone)
  compare('Bid role', match.bid_role, row.bid_role)
  compare('Active', match.active, row.active)
  const action = !match.active && row.active ? 'reactivate' : changes.length ? 'update' : 'unchanged'
  return { ...row, action, changes: changes.length ? changes : ['No changes'] }
}

function actionLabel(action: RosterImportAction) {
  return action === 'add' ? 'Add' : action === 'reactivate' ? 'Reactivate' : action === 'update' ? 'Update' : 'Unchanged'
}

export function RosterImporter() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [access, setAccess] = useState<AccessState>('checking')
  const [existing, setExisting] = useState<ExistingBidder[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<RosterImportPreview | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    let active = true
    const client = browserClient()
    setSupabase(client)
    async function initialize() {
      const { data: sessionData } = await client.auth.getSession()
      if (!active) return
      if (!sessionData.session) { setAccess('signed-out'); return }
      const { data: profileData, error: profileError } = await client.rpc('claim_current_bidder_profile')
      const profile = Array.isArray(profileData) ? profileData[0] : profileData
      if (!active) return
      if (profileError) { setStatus(profileError.message); setAccess('error'); return }
      if (profile?.role !== 'admin') { setAccess('denied'); return }
      const { data, error } = await client.rpc('read_bidding_roster', { include_inactive: true })
      if (!active) return
      if (error) { setStatus(error.message); setAccess('error'); return }
      setExisting((data || []) as ExistingBidder[])
      setAccess('admin')
    }
    void initialize()
    return () => { active = false }
  }, [])

  const previewValidation = useMemo(() => {
    if (!preview) return { rows: [] as PreviewRow[], conflicts: [] as string[] }
    const byId = new Map(existing.map((bidder) => [bidder.profile_id, bidder]))
    const byInitials = new Map<string, ExistingBidder[]>()
    const byAreaRank = new Map<string, ExistingBidder>()
    for (const bidder of existing) {
      const key = bidder.initials.toUpperCase()
      byInitials.set(key, [...(byInitials.get(key) || []), bidder])
      if (bidder.active && bidder.seniority_rank) byAreaRank.set(`${areaCode(bidder.area_name)}:${bidder.seniority_rank}`, bidder)
    }

    const conflicts: string[] = []
    const matches = preview.rows.map((row) => {
      if (row.profile_id) {
        const match = byId.get(row.profile_id) || null
        if (!match) conflicts.push(`Row ${row.sourceRow}: profile_id does not match an existing bidder.`)
        return match
      }
      const candidates = byInitials.get(row.initials) || []
      if (candidates.length > 1) conflicts.push(`Row ${row.sourceRow}: initials ${row.initials} match more than one bidder. Add profile_id.`)
      return candidates.length === 1 ? candidates[0] : null
    })
    const importedIds = new Set(matches.flatMap((match) => match ? [match.profile_id] : []))

    preview.rows.forEach((row, index) => {
      const match = matches[index]
      const initialsOwner = (byInitials.get(row.initials) || []).find((bidder) => bidder.profile_id !== match?.profile_id)
      if (initialsOwner) conflicts.push(`Row ${row.sourceRow}: initials ${row.initials} belong to another bidder.`)
      const emailOwner = row.email && existing.find((bidder) => bidder.active && bidder.email?.toLowerCase() === row.email && bidder.profile_id !== match?.profile_id)
      if (emailOwner) conflicts.push(`Row ${row.sourceRow}: email ${row.email} belongs to another active bidder.`)
      const rankOwner = byAreaRank.get(`${row.area_code}:${row.seniority_rank}`)
      if (row.active && rankOwner && rankOwner.profile_id !== match?.profile_id && !importedIds.has(rankOwner.profile_id)) {
        conflicts.push(`Row ${row.sourceRow}: ${row.area_code} rank ${row.seniority_rank} is occupied by ${rankOwner.initials}, who is not included in this import.`)
      }
    })

    return { rows: preview.rows.map((row, index) => compareRow(row, matches[index])), conflicts }
  }, [preview, existing])
  const previewRows = previewValidation.rows
  const counts = useMemo(() => previewRows.reduce((total, row) => ({ ...total, [row.action]: total[row.action] + 1 }), {
    add: 0, update: 0, unchanged: 0, reactivate: 0,
  }), [previewRows])

  function resetPreview(nextFile: File | null) {
    setFile(nextFile); setPreview(null); setIssues([]); setStatus(''); setResult(null)
  }

  async function previewFile() {
    if (!supabase || !file) return
    setBusy(true); setIssues([]); setResult(null); setStatus('Reading and validating the roster…')
    const requestTimeout = createImportRequestTimeout()
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Your session has expired. Sign in again.')
      const formData = new FormData(); formData.set('file', file)
      const response = await fetch('/api/admin/roster/preview', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData, signal: requestTimeout.signal,
      })
      const body = await response.json()
      if (!response.ok) { setIssues(Array.isArray(body.issues) ? body.issues : []); throw new Error(body.error || 'The roster could not be previewed.') }
      setPreview(body as RosterImportPreview)
      setStatus(`${body.rows.length} roster rows are ready for review.`)
    } catch (error) {
      setPreview(null)
      setStatus(requestTimeout.didExpire() ? importTimeoutMessage('preview') : error instanceof Error ? error.message : 'The roster could not be previewed.')
    } finally { requestTimeout.clear(); setBusy(false) }
  }

  async function commitImport() {
    if (!supabase || !preview) return
    setBusy(true); setIssues([]); setStatus('Saving the seniority roster…')
    const requestTimeout = createImportRequestTimeout()
    try {
      const { data, error } = await supabase.rpc('import_seniority_roster', { requested_rows: preview.rows }).abortSignal(requestTimeout.signal)
      if (requestTimeout.didExpire()) throw new Error(importTimeoutMessage('import'))
      if (error) throw error
      setResult(data as ImportResult)
      setStatus('Seniority roster import complete.')
    } catch (error) {
      if (requestTimeout.didExpire()) setPreview(null)
      setStatus(requestTimeout.didExpire() ? importTimeoutMessage('import') : error instanceof Error ? error.message : 'The import failed. No partial changes were saved.')
    } finally { requestTimeout.clear(); setBusy(false) }
  }

  if (access !== 'admin') {
    const message = access === 'checking' ? 'Checking administrator access…' : access === 'signed-out'
      ? 'Sign in through the bidding site before opening the importer.' : access === 'denied'
        ? 'This page is restricted to system administrators.' : status || 'Administrator access could not be verified.'
    return <main className="import-shell import-access-shell"><section className="import-card import-access-card">
      <p className="eyebrow">Roster administration</p><h1>{access === 'checking' ? 'One moment.' : 'Access required.'}</h1>
      <p className="import-lede">{message}</p><Link className="button primary" href="/bidding.html?page=admin">Return to bidding</Link>
    </section></main>
  }

  return <main className="import-shell">
    <nav className="import-nav"><Link className="brand" href="/bidding.html?page=admin">ZLA Bidding</Link><Link className="text-button" href="/bidding.html?page=admin">Back to Admin Console</Link></nav>
    <header className="import-hero"><div><p className="eyebrow">System administration</p><h1>Import seniority roster.</h1>
      <p className="import-lede">Upload all areas in one Excel or CSV file, review additions and changes, then save the roster as one transaction.</p></div>
      <a className="button secondary" href="/templates/zla-seniority-roster-template.xlsx" download>Download Excel template</a>
    </header>
    <section className="import-card import-controls" aria-labelledby="upload-heading">
      <div className="import-section-heading"><div><span>1</span><div><h2 id="upload-heading">Choose the roster file</h2><p>Use one combined sheet or separate sheets for each area.</p></div></div></div>
      <div className="import-field-grid roster-import-fields"><label className="import-file-field">Excel or CSV file
        <input type="file" accept=".xlsx,.csv" onChange={(event) => resetPreview(event.target.files?.[0] || null)} />
        <small>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : 'Maximum file size: 8 MB'}</small>
      </label></div>
      <p className="import-safety-note"><strong>Safe update:</strong> Existing bidders are matched by profile ID or initials. Their account links, submitted bids, and leave records stay attached. Blank email and phone cells keep the current values. Omitted bidders remain unchanged.</p>
      <button className="button primary" type="button" disabled={busy || !file} onClick={() => void previewFile()}>{busy && !preview ? 'Validating…' : 'Preview import'}</button>
    </section>
    {status ? <p className={`import-status ${result ? 'success' : issues.length ? 'error' : ''}`} role="status">{status}</p> : null}
    {issues.length ? <section className="import-issues"><h2>Fix these roster rows</h2><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section> : null}
    {preview ? <section className="import-card import-preview" aria-labelledby="preview-heading">
      <div className="import-section-heading"><div><span>2</span><div><h2 id="preview-heading">Review roster changes</h2>
        <p>{preview.fileName} · {counts.add} add · {counts.update} update · {counts.reactivate} reactivate · {counts.unchanged} unchanged</p></div></div><strong className="import-count">{preview.rows.length}</strong></div>
      {preview.warnings.length ? <ul className="import-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {previewValidation.conflicts.length ? <div className="import-issues"><h2>Resolve these roster conflicts</h2><ul>{previewValidation.conflicts.map((conflict, index) => <li key={`${index}-${conflict}`}>{conflict}</li>)}</ul></div> : null}
      <div className="import-table-wrap roster-import-table"><table><thead><tr><th>Action</th><th>Area</th><th>Rank</th><th>Name</th><th>Initials</th><th>Bid role</th><th>Email</th><th>Changes</th></tr></thead>
        <tbody>{previewRows.map((row) => <tr key={`${row.sourceSheet}-${row.sourceRow}`}><td><span className={`import-action ${row.action}`}>{actionLabel(row.action)}</span></td><td>{row.area_code}</td><td><strong>{row.seniority_rank}</strong></td><td>{row.first_name} {row.last_name}</td><td>{row.initials}</td><td>{row.bid_role}</td><td>{row.email || 'Keep current'}</td><td className="import-changes">{row.changes.join('; ')}</td></tr>)}</tbody>
      </table></div>
      <div className="import-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => resetPreview(file)}>Choose another file</button><button className="button primary" type="button" disabled={busy || previewValidation.conflicts.length > 0} onClick={() => void commitImport()}>{busy ? 'Saving…' : `Import ${preview.rows.length} roster rows`}</button></div>
    </section> : null}
    {result ? <section className="import-card import-result"><p className="eyebrow">Import complete</p><h2>The seniority roster is updated.</h2><dl><div><dt>Added</dt><dd>{result.bidders_added}</dd></div><div><dt>Updated</dt><dd>{result.bidders_updated}</dd></div><div><dt>Unchanged</dt><dd>{result.bidders_unchanged}</dd></div></dl><Link className="button primary" href="/bidding.html?page=admin">Return to Admin Console</Link></section> : null}
  </main>
}
