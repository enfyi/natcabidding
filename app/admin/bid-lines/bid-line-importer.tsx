'use client'

import Link from 'next/link'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import type { BidLineImportPreview, BidLineImportRow } from '@/lib/bid-line-import-types'
import { getSupabaseEnv } from '@/lib/env'

type AreaOption = { code: string; name: string }
type BidYearOption = { bid_year: number; status: string }
type ImportResult = { inserted: number; updated: number; processed: number }
type AccessState = 'checking' | 'admin' | 'signed-out' | 'denied' | 'error'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

declare global {
  interface Window {
    __zlaBidLineSupabase?: SupabaseClient
  }
}

function browserClient() {
  if (window.__zlaBidLineSupabase) return window.__zlaBidLineSupabase

  const { url, publishableKey } = getSupabaseEnv()
  window.__zlaBidLineSupabase = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return window.__zlaBidLineSupabase
}

function importPayload(lines: BidLineImportRow[]) {
  return lines.map(({ sourceRow: _sourceRow, sourceSheet: _sourceSheet, ...line }) => line)
}

function bidLineSection(line: BidLineImportRow) {
  if (line.line_type === 'CPC') return 'CPC'
  return line.pattern === 'D-DEV' ? 'D-Dev' : 'R-Dev'
}

export function BidLineImporter() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [access, setAccess] = useState<AccessState>('checking')
  const [areas, setAreas] = useState<AreaOption[]>([])
  const [bidYears, setBidYears] = useState<BidYearOption[]>([])
  const [areaCode, setAreaCode] = useState('')
  const [bidYear, setBidYear] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BidLineImportPreview | null>(null)
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
      const response = await fetch('/api/admin/bid-lines/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) {
        setIssues(Array.isArray(body.issues) ? body.issues : [])
        throw new Error(body.error || 'The workbook could not be previewed.')
      }

      setPreview(body as BidLineImportPreview)
      setStatus(`${body.lines.length} bid lines are ready to import.`)
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
    setStatus('Importing bid lines into Supabase…')

    try {
      const { data, error } = await supabase.rpc('import_bid_line_schedule', {
        requested_bid_year: Number(bidYear),
        requested_area_code: areaCode,
        requested_lines: importPayload(preview.lines),
      })
      if (error) throw error

      const imported = data as ImportResult
      setResult(imported)
      setStatus(`Import complete: ${imported.inserted} added and ${imported.updated} updated.`)
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
          <p className="eyebrow">Bid-line administration</p>
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
          <h1>Import bid lines.</h1>
          <p className="import-lede">Upload one area at a time. The workbook keeps CPC, R-Dev, and D-Dev lines on separate tabs.</p>
        </div>
        <a className="button secondary" href="/templates/zla-bid-line-import-template.xlsx" download>
          Download Excel template
        </a>
      </header>

      <section className="import-card import-controls" aria-labelledby="upload-heading">
        <div className="import-section-heading">
          <div>
            <span>1</span>
            <div>
              <h2 id="upload-heading">Choose the destination</h2>
              <p>The selected year and area apply to every row in the workbook.</p>
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
            <small>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : 'Use the template with CPC, R-Dev, and D-Dev tabs. Legacy one-sheet files still work.'}</small>
          </label>
        </div>

        <p className="import-safety-note"><strong>Safe add/update:</strong> Matching line codes are updated and new codes are added. Blank Fatigue, AWS, and Flex cells preserve existing values; new lines use C, No, and Yes. Lines omitted from the workbook are never deleted.</p>

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
                <p>{preview.lines.length} lines from {preview.fileName} · {bidYear} bid year</p>
              </div>
            </div>
            <strong className="import-count">{preview.lines.length}</strong>
          </div>

          {preview.warnings.length ? <ul className="import-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}

          <div className="import-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sheet</th><th>Row</th><th>Line</th><th>Section</th><th>Pattern</th><th>Fatigue</th><th>Mid</th><th>AWS</th><th>4/10</th><th>Flex</th>
                  {DAY_LABELS.map((day) => <th key={day}>{day}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={`${line.sourceRow}-${line.line_code}`}>
                    <td>{line.sourceSheet}</td><td>{line.sourceRow}</td><td><strong>{line.line_code}</strong></td><td>{bidLineSection(line)}</td><td>{line.pattern}</td><td>{line.fatigue_group || 'Default / unchanged'}</td><td>{line.mid}</td>
                    <td>{line.aws === null ? 'Default / unchanged' : line.aws ? 'Yes' : 'No'}</td><td>{line.four_ten ? 'Yes' : 'No'}</td><td>{line.flex === null ? 'Yes / unchanged' : line.flex ? 'Yes' : 'No'}</td>
                    {line.days.map((day, index) => <td className={day === 'RDO' ? 'rdo' : ''} key={`${line.line_code}-${index}`}>{day}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="import-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => resetPreview(file)}>Choose another file</button>
            <button className="button primary" type="button" disabled={busy} onClick={() => void commitImport()}>
              {busy ? 'Saving…' : `Import ${preview.lines.length} lines`}
            </button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="import-card import-result">
          <p className="eyebrow">Import complete</p>
          <h2>{selectedArea} is updated.</h2>
          <dl className="two-column">
            <div><dt>Added</dt><dd>{result.inserted}</dd></div>
            <div><dt>Updated</dt><dd>{result.updated}</dd></div>
          </dl>
          <Link className="button primary" href="/bidding.html?page=admin">Return to Admin Console</Link>
        </section>
      ) : null}
    </main>
  )
}
