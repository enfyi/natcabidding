'use client'

import Link from 'next/link'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import type { BidTimeImportPreview, BidTimeImportRow } from '@/lib/bid-time-import-types'
import { getSupabaseEnv } from '@/lib/env'

type AreaOption = { code: string; name: string }
type BidYearOption = { bid_year: number; status: string }
type ImportResult = { bidders_processed: number; windows_inserted: number; windows_updated: number; windows_processed: number }
type AccessState = 'checking' | 'admin' | 'signed-out' | 'denied' | 'error'

declare global {
  interface Window {
    __zlaBidTimeSupabase?: SupabaseClient
  }
}

function browserClient() {
  if (window.__zlaBidTimeSupabase) return window.__zlaBidTimeSupabase

  const { url, publishableKey } = getSupabaseEnv()
  window.__zlaBidTimeSupabase = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return window.__zlaBidTimeSupabase
}

function importPayload(bidders: BidTimeImportRow[]) {
  return bidders.map(({ sourceRow: _sourceRow, ...bidder }) => bidder)
}

function displayDateTime(value: string | null) {
  if (!value) return 'No change'
  const [date, time] = value.split('T')
  return `${date} ${time}`
}

export function BidTimeImporter() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [access, setAccess] = useState<AccessState>('checking')
  const [areas, setAreas] = useState<AreaOption[]>([])
  const [bidYears, setBidYears] = useState<BidYearOption[]>([])
  const [areaCode, setAreaCode] = useState('')
  const [bidYear, setBidYear] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BidTimeImportPreview | null>(null)
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
      if (!sessionData.session) {
        setAccess('signed-out')
        return
      }

      const { data: profileData, error: profileError } = await client.rpc('claim_current_bidder_profile')
      const profile = Array.isArray(profileData) ? profileData[0] : profileData
      if (!active) return
      if (profileError) {
        setStatus(profileError.message)
        setAccess('error')
        return
      }
      if (profile?.role !== 'admin') {
        setAccess('denied')
        return
      }

      const [areasResult, yearsResult] = await Promise.all([
        client.from('areas').select('code,name').order('display_order'),
        client.from('bid_years').select('bid_year,status').order('bid_year', { ascending: false }),
      ])
      if (!active) return
      if (areasResult.error || yearsResult.error) {
        setStatus(areasResult.error?.message || yearsResult.error?.message || 'Could not load import options.')
        setAccess('error')
        return
      }

      const nextAreas = (areasResult.data || []) as AreaOption[]
      const nextYears = (yearsResult.data || []) as BidYearOption[]
      setAreas(nextAreas)
      setBidYears(nextYears)
      setAreaCode(nextAreas[0]?.code || '')
      setBidYear(String(nextYears[0]?.bid_year || ''))
      setAccess('admin')
    }

    void initialize()
    return () => { active = false }
  }, [])

  function resetPreview(nextFile: File | null) {
    setFile(nextFile)
    setPreview(null)
    setIssues([])
    setStatus('')
    setResult(null)
  }

  async function previewFile() {
    if (!supabase || !file || !areaCode || !bidYear) {
      setStatus('Choose a bid year, area, and workbook first.')
      return
    }

    setBusy(true)
    setIssues([])
    setStatus('Reading and validating the workbook…')
    setResult(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Your session has expired. Sign in again.')

      const formData = new FormData()
      formData.set('file', file)
      const response = await fetch('/api/admin/bid-times/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) {
        setIssues(Array.isArray(body.issues) ? body.issues : [])
        throw new Error(body.error || 'The workbook could not be previewed.')
      }

      setPreview(body as BidTimeImportPreview)
      setStatus(`${body.windowCount} bid windows for ${body.bidders.length} bidders are ready to import.`)
    } catch (error) {
      setPreview(null)
      setStatus(error instanceof Error ? error.message : 'The workbook could not be previewed.')
    } finally {
      setBusy(false)
    }
  }

  async function commitImport() {
    if (!supabase || !preview) return
    setBusy(true)
    setIssues([])
    setStatus('Importing bid times into Supabase…')

    try {
      const { data, error } = await supabase.rpc('import_bid_time_schedule', {
        requested_bid_year: Number(bidYear),
        requested_area_code: areaCode,
        requested_bidders: importPayload(preview.bidders),
      })
      if (error) throw error

      const imported = data as ImportResult
      setResult(imported)
      setStatus(`Import complete: ${imported.windows_inserted} windows added and ${imported.windows_updated} updated.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The import failed. No partial changes were saved.')
    } finally {
      setBusy(false)
    }
  }

  if (access !== 'admin') {
    const message = access === 'checking'
      ? 'Checking administrator access…'
      : access === 'signed-out'
        ? 'Sign in through the bidding site before opening the importer.'
        : access === 'denied'
          ? 'This page is restricted to system administrators.'
          : status || 'Administrator access could not be verified.'

    return (
      <main className="import-shell import-access-shell">
        <section className="import-card import-access-card">
          <p className="eyebrow">Bid-time administration</p>
          <h1>{access === 'checking' ? 'One moment.' : 'Access required.'}</h1>
          <p className="import-lede">{message}</p>
          <Link className="button primary" href="/bidding.html?page=admin">Return to bidding</Link>
        </section>
      </main>
    )
  }

  const selectedArea = areas.find((area) => area.code === areaCode)?.name || areaCode

  return (
    <main className="import-shell">
      <nav className="import-nav">
        <Link className="brand" href="/bidding.html?page=admin">ZLA Bidding</Link>
        <Link className="text-button" href="/bidding.html?page=admin">Back to Admin Console</Link>
      </nav>

      <header className="import-hero">
        <div>
          <p className="eyebrow">System administration</p>
          <h1>Import bid times.</h1>
          <p className="import-lede">Upload one area at a time, preview each bidder’s four rounds, then save the selected windows to Supabase.</p>
        </div>
        <a className="button secondary" href="/templates/zla-bid-time-import-template.xlsx" download>
          Download Excel template
        </a>
      </header>

      <section className="import-card import-controls" aria-labelledby="upload-heading">
        <div className="import-section-heading">
          <div>
            <span>1</span>
            <div>
              <h2 id="upload-heading">Choose the destination</h2>
              <p>The selected year and area apply to every bidder row.</p>
            </div>
          </div>
        </div>

        <div className="import-field-grid">
          <label>
            Bid year
            <select value={bidYear} onChange={(event) => { setBidYear(event.target.value); setPreview(null); setResult(null) }}>
              {bidYears.map((year) => <option key={year.bid_year} value={year.bid_year}>{year.bid_year} · {year.status}</option>)}
            </select>
          </label>
          <label>
            Area
            <select value={areaCode} onChange={(event) => { setAreaCode(event.target.value); setPreview(null); setResult(null) }}>
              {areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
            </select>
          </label>
          <label className="import-file-field">
            Excel or CSV file
            <input type="file" accept=".xlsx,.csv" onChange={(event) => resetPreview(event.target.files?.[0] || null)} />
            <small>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : 'Use Pacific local time in the template.'}</small>
          </label>
        </div>

        <p className="import-safety-note"><strong>Safe add/update:</strong> Only populated round cells are added or updated. Omitted bidders and blank round cells remain unchanged.</p>

        <button className="button primary" type="button" disabled={busy || !file} onClick={() => void previewFile()}>
          {busy && !preview ? 'Validating…' : 'Preview import'}
        </button>
      </section>

      {status ? <p className={`import-status ${result ? 'success' : issues.length ? 'error' : ''}`} role="status">{status}</p> : null}
      {issues.length ? (
        <section className="import-issues" aria-label="Workbook errors">
          <h2>Fix these workbook rows</h2>
          <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </section>
      ) : null}

      {preview ? (
        <section className="import-card import-preview" aria-labelledby="preview-heading">
          <div className="import-section-heading">
            <div>
              <span>2</span>
              <div>
                <h2 id="preview-heading">Review {selectedArea}</h2>
                <p>{preview.windowCount} windows for {preview.bidders.length} bidders from {preview.fileName} · {bidYear} bid year</p>
              </div>
            </div>
            <strong className="import-count">{preview.windowCount}</strong>
          </div>

          {preview.warnings.length ? <ul className="import-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}

          <div className="import-table-wrap bid-time-import-table">
            <table>
              <thead>
                <tr><th>Row</th><th>Rank</th><th>Initials</th><th>Round 1</th><th>Round 2</th><th>Round 3</th><th>Round 4</th></tr>
              </thead>
              <tbody>
                {preview.bidders.map((bidder) => (
                  <tr key={`${bidder.sourceRow}-${bidder.seniority_rank}`}>
                    <td>{bidder.sourceRow}</td><td><strong>{bidder.seniority_rank}</strong></td><td>{bidder.initials || '—'}</td>
                    {bidder.round_starts.map((start, index) => <td key={`${bidder.seniority_rank}-${index}`}>{displayDateTime(start)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="import-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => resetPreview(file)}>Choose another file</button>
            <button className="button primary" type="button" disabled={busy} onClick={() => void commitImport()}>
              {busy ? 'Saving…' : `Import ${preview.windowCount} windows`}
            </button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="import-card import-result">
          <p className="eyebrow">Import complete</p>
          <h2>{selectedArea} bid times are updated.</h2>
          <dl>
            <div><dt>Bidders</dt><dd>{result.bidders_processed}</dd></div>
            <div><dt>Added</dt><dd>{result.windows_inserted}</dd></div>
            <div><dt>Updated</dt><dd>{result.windows_updated}</dd></div>
          </dl>
          <Link className="button primary" href="/bidding.html?page=admin">Return to Admin Console</Link>
        </section>
      ) : null}
    </main>
  )
}
