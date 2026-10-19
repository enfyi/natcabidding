'use client'

import Link from 'next/link'
import ActionStatus from '@/app/components/action-status'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import type { BidLineImportPreview, BidLineImportRow } from '@/lib/bid-line-import-types'
import { getBasePath, getSupabaseEnv } from '@/lib/env'
import { createImportRequestTimeout, importTimeoutMessage } from '@/lib/import-timeout'

type AreaOption = { id: string; code: string; name: string }
type BidYearOption = { id: string; bid_year: number; status: string }
type ImportResult = { inserted: number; updated: number; processed: number }
type AccessState = 'checking' | 'admin' | 'signed-out' | 'denied' | 'error'
type ExistingBidLine = {
  id: string
  line_code: string
  display_order: number
  line_type: 'CPC' | 'DEV'
  pattern: string
  fatigue_group: 'A' | 'B' | 'C' | 'C only' | 'B only' | null
  mid: 'No' | 'BID'
  aws: boolean
  four_ten: boolean
  flex: boolean
  status: 'open' | 'taken' | 'locked'
  assigned_bidder_id: string | null
  rdo_line_days: { weekday: number; shift_code: string }[]
}

type SupabaseReadError = { message?: string } | null

type BidLineSection = 'CPC' | 'R-DEV' | 'D-DEV'
type BidLineSortKey = 'display_order' | 'line_code' | 'section' | 'pattern' | 'mid' | 'status' | `day-${number}`
type BidLineSort = { key: BidLineSortKey; direction: 'asc' | 'desc' }
type BidLineDraft = {
  area_code: string
  line_code: string
  section: BidLineSection
  pattern: string
  fatigue_group: 'A' | 'B' | 'C' | 'C only' | 'B only'
  mid: boolean
  aws: boolean
  four_ten: boolean
  flex: boolean
  days: string[]
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BID_LINE_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const basePath = getBasePath()

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

function isMissingDisplayOrder(error: SupabaseReadError) {
  const message = error?.message || ''
  return /display_order/i.test(message)
    && /does not exist|Could not find|schema cache|PGRST204|PGRST205/i.test(message)
}

function sectionForLine(line: ExistingBidLine): BidLineSection {
  if (line.line_type === 'CPC') return 'CPC'
  return line.pattern === 'D-DEV' ? 'D-DEV' : 'R-DEV'
}

function emptyDraft(areaCode: string): BidLineDraft {
  return {
    area_code: areaCode,
    line_code: '',
    section: 'CPC',
    pattern: '',
    fatigue_group: 'C',
    mid: false,
    aws: false,
    four_ten: false,
    flex: true,
    days: Array.from({ length: 7 }, () => ''),
  }
}

function draftForLine(line: ExistingBidLine, areaCode: string): BidLineDraft {
  const days = Array.from({ length: 7 }, () => '')
  line.rdo_line_days.forEach((day) => { days[day.weekday] = day.shift_code })
  return {
    area_code: areaCode,
    line_code: line.line_code,
    section: sectionForLine(line),
    pattern: line.pattern,
    fatigue_group: line.fatigue_group || 'C',
    mid: line.mid === 'BID',
    aws: line.aws,
    four_ten: line.four_ten,
    flex: line.flex,
    days,
  }
}

function daysForLine(line: ExistingBidLine) {
  const days = Array.from({ length: 7 }, () => '')
  line.rdo_line_days.forEach((day) => { days[day.weekday] = day.shift_code })
  return days
}

function bidLineSortValue(line: ExistingBidLine, key: BidLineSortKey) {
  if (key === 'display_order') return line.display_order
  if (key === 'line_code') return line.line_code
  if (key === 'section') return sectionForLine(line)
  if (key === 'pattern') return line.pattern
  if (key === 'mid') return line.mid
  if (key === 'status') return line.status
  const weekday = Number(key.slice(4))
  return daysForLine(line)[weekday] || ''
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
  const [existingLines, setExistingLines] = useState<ExistingBidLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [lineManagementStatus, setLineManagementStatus] = useState('')
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null)
  const [savingLine, setSavingLine] = useState(false)
  const [reorderingLineId, setReorderingLineId] = useState<string | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [lineDraft, setLineDraft] = useState<BidLineDraft | null>(null)
  const [lineSort, setLineSort] = useState<BidLineSort>({ key: 'display_order', direction: 'asc' })
  const [linesReloadToken, setLinesReloadToken] = useState(0)

  const sortedExistingLines = useMemo(() => {
    const direction = lineSort.direction === 'asc' ? 1 : -1
    return existingLines
      .map((line, originalIndex) => ({ line, originalIndex }))
      .sort((left, right) => {
        const leftValue = bidLineSortValue(left.line, lineSort.key)
        const rightValue = bidLineSortValue(right.line, lineSort.key)
        const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : BID_LINE_COLLATOR.compare(String(leftValue), String(rightValue))
        return comparison ? comparison * direction : left.originalIndex - right.originalIndex
      })
      .map(({ line }) => line)
  }, [existingLines, lineSort])

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
        client.from('areas').select('id,code,name').order('display_order'),
        client.from('bid_years').select('id,bid_year,status').order('bid_year', { ascending: false }),
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
      setBidYear(String(nextYears[0]?.bid_year || ''))
      setAccess('admin')
    }

    void initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const areaId = areas.find((area) => area.code === areaCode)?.id
    const bidYearId = bidYears.find((year) => String(year.bid_year) === bidYear)?.id
    if (!supabase || access !== 'admin' || !areaId || !bidYearId) {
      setExistingLines([])
      setLinesLoading(false)
      return
    }

    let active = true
    const client = supabase
    setLinesLoading(true)
    setLineManagementStatus('')

    async function loadExistingLines() {
      const orderedResult = await client
        .from('rdo_lines')
        .select('id,line_code,display_order,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status,assigned_bidder_id,rdo_line_days(weekday,shift_code)')
        .eq('bid_year_id', bidYearId)
        .eq('area_id', areaId)
        .order('display_order')
        .order('line_code')
      let data: unknown[] | null = orderedResult.data
      let error: SupabaseReadError = orderedResult.error
      let migrationPending = false

      if (isMissingDisplayOrder(error)) {
        migrationPending = true
        const legacyResult = await client
          .from('rdo_lines')
          .select('id,line_code,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status,assigned_bidder_id,rdo_line_days(weekday,shift_code)')
          .eq('bid_year_id', bidYearId)
          .eq('area_id', areaId)
          .order('line_code')
        data = legacyResult.data
        error = legacyResult.error
      }

      if (!active) return
      if (error) {
        setExistingLines([])
        setLineManagementStatus(error.message || 'Bid lines could not be loaded.')
      } else {
        setExistingLines((data || []).map((line, index) => ({
          ...(line as object),
          display_order: typeof line === 'object' && line && 'display_order' in line
            ? Number(line.display_order)
            : (index + 1) * 10,
        })) as ExistingBidLine[])
        if (migrationPending) {
          setLineManagementStatus('Existing lines are loaded. Apply the bid-line editor database migration to enable adding, editing, and reordering.')
        }
      }
      setLinesLoading(false)
    }

    void loadExistingLines()

    return () => { active = false }
  }, [access, areaCode, areas, bidYear, bidYears, linesReloadToken, supabase])

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
    const requestTimeout = createImportRequestTimeout()

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Your session has expired. Sign in again.')

      const formData = new FormData()
      formData.set('file', file)
      const response = await fetch(`${basePath}/api/admin/bid-lines/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
        signal: requestTimeout.signal,
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
      setStatus(requestTimeout.didExpire()
        ? importTimeoutMessage('preview')
        : error instanceof Error ? error.message : 'The workbook could not be previewed.')
    } finally {
      requestTimeout.clear()
      setBusy(false)
    }
  }

  async function commitImport() {
    if (!supabase || !preview) return
    setBusy(true)
    setIssues([])
    setStatus('Importing bid lines into Supabase…')
    const requestTimeout = createImportRequestTimeout()

    try {
      const { data, error } = await supabase
        .rpc('import_bid_line_schedule', {
          requested_bid_year: Number(bidYear),
          requested_area_code: areaCode,
          requested_lines: importPayload(preview.lines),
        })
        .abortSignal(requestTimeout.signal)
      if (requestTimeout.didExpire()) throw new Error(importTimeoutMessage('import'))
      if (error) throw new Error(error.message)

      const imported = data as ImportResult
      setResult(imported)
      setStatus(`Import complete: ${imported.inserted} added and ${imported.updated} updated.`)
      setLinesReloadToken((value) => value + 1)
    } catch (error) {
      if (requestTimeout.didExpire()) setPreview(null)
      setStatus(requestTimeout.didExpire()
        ? importTimeoutMessage('import')
        : error instanceof Error ? error.message : 'The import failed. No partial changes were saved.')
    } finally {
      requestTimeout.clear()
      setBusy(false)
    }
  }

  async function deleteBidLine(line: ExistingBidLine) {
    if (!supabase) return
    const confirmed = window.confirm(
      `Permanently delete RDO line ${line.line_code}?\n\nThis is only allowed when the line is open, unassigned, and has no bidding history. This action cannot be undone.`,
    )
    if (!confirmed) return

    setDeletingLineId(line.id)
    setLineManagementStatus(`Deleting line ${line.line_code}…`)

    try {
      const { error } = await supabase.rpc('admin_delete_bid_line', { target_line_id: line.id })
      if (error) throw new Error(error.message)
      setExistingLines((lines) => lines.filter((candidate) => candidate.id !== line.id))
      setLineManagementStatus(`Line ${line.line_code} was deleted.`)
      setPreview(null)
      setResult(null)
    } catch (error) {
      setLineManagementStatus(error instanceof Error ? error.message : `Line ${line.line_code} could not be deleted.`)
    } finally {
      setDeletingLineId(null)
    }
  }

  function startAddingLine() {
    setEditingLineId('new')
    setLineDraft(emptyDraft(areaCode))
    setLineManagementStatus('')
  }

  function startEditingLine(line: ExistingBidLine) {
    setEditingLineId(line.id)
    setLineDraft(draftForLine(line, areaCode))
    setLineManagementStatus('')
  }

  function updateLineDraft(update: Partial<BidLineDraft>) {
    setLineDraft((current) => current ? { ...current, ...update } : current)
  }

  function updateDraftDay(index: number, value: string) {
    setLineDraft((current) => {
      if (!current) return current
      const days = [...current.days]
      days[index] = value.toUpperCase()
      return { ...current, days }
    })
  }

  function changeLineSort(key: BidLineSortKey) {
    setLineSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' })
  }

  function sortableHeader(key: BidLineSortKey, label: string) {
    const active = lineSort.key === key
    const ariaSort = active ? (lineSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
    return (
      <th key={key} aria-sort={ariaSort}>
        <button className="bid-line-sort-button" type="button" onClick={() => changeLineSort(key)}>
          <span>{label}</span>
          <span aria-hidden="true">{active ? lineSort.direction === 'asc' ? '▲' : '▼' : '↕'}</span>
        </button>
      </th>
    )
  }

  async function saveBidLine() {
    if (!supabase || !lineDraft) return
    const normalizedDays = lineDraft.days.map((day) => day.trim().toUpperCase())
    if (!lineDraft.area_code || !lineDraft.line_code.trim() || normalizedDays.some((day) => !day)) {
      setLineManagementStatus('Choose an area and enter a line code plus all seven shift times or RDOs.')
      return
    }
    if (lineDraft.section === 'CPC' && !lineDraft.pattern.trim()) {
      setLineManagementStatus('Enter the CPC line pattern.')
      return
    }

    setSavingLine(true)
    setLineManagementStatus(editingLineId === 'new' ? 'Adding bid line…' : 'Saving bid-line changes…')
    try {
      const pattern = lineDraft.section === 'CPC' ? lineDraft.pattern.trim().toUpperCase() : lineDraft.section
      const { error } = await supabase.rpc('admin_save_bid_line', {
        target_line_id: editingLineId === 'new' ? null : editingLineId,
        requested_bid_year: Number(bidYear),
        requested_area_code: lineDraft.area_code,
        requested_line: {
          line_code: lineDraft.line_code.trim(),
          line_type: lineDraft.section === 'CPC' ? 'CPC' : 'DEV',
          pattern,
          fatigue_group: lineDraft.fatigue_group,
          mid: lineDraft.mid ? 'BID' : 'No',
          aws: lineDraft.aws,
          four_ten: lineDraft.four_ten,
          flex: lineDraft.flex,
          days: normalizedDays,
        },
      })
      if (error) throw new Error(error.message)

      const savedCode = lineDraft.line_code.trim()
      const savedArea = lineDraft.area_code
      setEditingLineId(null)
      setLineDraft(null)
      setLineManagementStatus(`Line ${savedCode} was saved.`)
      if (savedArea !== areaCode) setAreaCode(savedArea)
      else setLinesReloadToken((value) => value + 1)
      setPreview(null)
      setResult(null)
    } catch (error) {
      setLineManagementStatus(error instanceof Error ? error.message : 'The bid line could not be saved.')
    } finally {
      setSavingLine(false)
    }
  }

  async function moveBidLine(lineId: string, direction: -1 | 1) {
    if (!supabase) return
    const currentIndex = existingLines.findIndex((line) => line.id === lineId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= existingLines.length) return

    const reordered = [...existingLines]
    ;[reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]]
    setExistingLines(reordered)
    setReorderingLineId(lineId)
    setLineManagementStatus('Saving the new line order…')

    try {
      const { error } = await supabase.rpc('admin_reorder_bid_lines', {
        requested_bid_year: Number(bidYear),
        requested_area_code: areaCode,
        ordered_line_ids: reordered.map((line) => line.id),
      })
      if (error) throw new Error(error.message)
      setLineManagementStatus('Line order saved.')
    } catch (error) {
      setLineManagementStatus(error instanceof Error ? error.message : 'The line order could not be saved.')
      setLinesReloadToken((value) => value + 1)
    } finally {
      setReorderingLineId(null)
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
          <h1>Manage bid lines.</h1>
          <p className="import-lede">Upload a schedule, then add, edit, delete, or reorder the CPC, R-Dev, and D-Dev lines for each area.</p>
        </div>
        <a className="button secondary" href={`${basePath}/templates/zla-bid-line-import-template.xlsx`} download>
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
            <select value={bidYear} onChange={(event) => { setBidYear(event.target.value); setPreview(null); setResult(null); setEditingLineId(null); setLineDraft(null) }}>
              {bidYears.map((year) => <option key={year.bid_year} value={year.bid_year}>{year.bid_year} · {year.status}</option>)}
            </select>
          </label>
          <label>
            Area
            <select required value={areaCode} onChange={(event) => { setAreaCode(event.target.value); setPreview(null); setResult(null); setEditingLineId(null); setLineDraft(null) }}>
              <option value="" disabled>Select an area</option>
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

        <button className="button primary" type="button" disabled={busy || !file || !areaCode} onClick={() => void previewFile()}>
          {busy && !preview ? 'Validating…' : 'Preview import'}
        </button>
      </section>

      <ActionStatus message={status} busy={busy} className={`import-status ${result ? 'success' : issues.length ? 'error' : ''}`} />
      {issues.length ? (
        <section className="import-issues" aria-label="Workbook errors">
          <h2>Fix these workbook rows</h2>
          <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </section>
      ) : null}

      {areaCode && bidYear ? (
        <section className="import-card import-line-manager" aria-labelledby="line-manager-heading">
          <div className="import-section-heading">
            <div>
              <div>
                <h2 id="line-manager-heading">Manage existing lines</h2>
                <p>Add, edit, delete, or reorder {selectedArea} lines for the {bidYear} bid year.</p>
              </div>
            </div>
            <div className="import-line-manager-heading-actions">
              <strong className="import-count">{existingLines.length}</strong>
              <button className="button primary compact" type="button" onClick={startAddingLine}>Add line</button>
            </div>
          </div>

          <p className="import-safety-note import-editor-note"><strong>Area-specific:</strong> Every line belongs to one bid year and area. Up and Down set the order bidders see. Assigned, taken, locked, or historically referenced lines remain protected from deletion.</p>
          <ActionStatus message={lineManagementStatus} busy={savingLine || deletingLineId !== null || reorderingLineId !== null} className="import-inline-status" />

          {lineDraft ? (
            <section className="bid-line-editor" aria-labelledby="bid-line-editor-heading">
              <div className="bid-line-editor-heading">
                <div>
                  <p className="eyebrow">{editingLineId === 'new' ? 'New bid line' : 'Editing bid line'}</p>
                  <h3 id="bid-line-editor-heading">{editingLineId === 'new' ? 'Build a line' : `Line ${lineDraft.line_code}`}</h3>
                </div>
                <button className="text-button" type="button" disabled={savingLine} onClick={() => { setEditingLineId(null); setLineDraft(null) }}>Cancel</button>
              </div>

              <div className="bid-line-editor-grid">
                <label>
                  Area
                  <select value={lineDraft.area_code} onChange={(event) => updateLineDraft({ area_code: event.target.value })}>
                    {areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
                  </select>
                </label>
                <label>
                  Line code
                  <input maxLength={40} value={lineDraft.line_code} onChange={(event) => updateLineDraft({ line_code: event.target.value })} placeholder="Example: 12" />
                </label>
                <label>
                  Section
                  <select value={lineDraft.section} onChange={(event) => updateLineDraft({ section: event.target.value as BidLineSection })}>
                    <option value="CPC">CPC</option>
                    <option value="R-DEV">R-DEV</option>
                    <option value="D-DEV">D-DEV</option>
                  </select>
                </label>
                <label>
                  Pattern
                  <input
                    maxLength={40}
                    disabled={lineDraft.section !== 'CPC'}
                    value={lineDraft.section === 'CPC' ? lineDraft.pattern : lineDraft.section}
                    onChange={(event) => updateLineDraft({ pattern: event.target.value })}
                    placeholder="Example: S/M"
                  />
                </label>
                <label>
                  Fatigue group
                  <select value={lineDraft.fatigue_group} onChange={(event) => updateLineDraft({ fatigue_group: event.target.value as BidLineDraft['fatigue_group'] })}>
                    <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="C only">C only</option><option value="B only">B only</option>
                  </select>
                </label>
              </div>

              <fieldset className="bid-line-options">
                <legend>Line options</legend>
                <label><input type="checkbox" checked={lineDraft.mid} onChange={(event) => updateLineDraft({ mid: event.target.checked })} /> Mid Bid line</label>
                <label><input type="checkbox" checked={lineDraft.aws} onChange={(event) => updateLineDraft({ aws: event.target.checked })} /> AWS</label>
                <label><input type="checkbox" checked={lineDraft.four_ten} onChange={(event) => updateLineDraft({ four_ten: event.target.checked })} /> 4/10</label>
                <label><input type="checkbox" checked={lineDraft.flex} onChange={(event) => updateLineDraft({ flex: event.target.checked })} /> Flex</label>
              </fieldset>

              <fieldset className="bid-line-schedule">
                <legend>Shift start times and RDOs</legend>
                <p>Enter a start time such as 0630, or enter RDO.</p>
                <div>
                  {DAY_LABELS.map((day, index) => (
                    <label key={day}>
                      {day}
                      <input maxLength={20} value={lineDraft.days[index]} onChange={(event) => updateDraftDay(index, event.target.value)} placeholder="RDO" />
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="import-actions">
                <button className="button secondary" type="button" disabled={savingLine} onClick={() => { setEditingLineId(null); setLineDraft(null) }}>Cancel</button>
                <button className="button primary" type="button" disabled={savingLine} onClick={() => void saveBidLine()}>{savingLine ? 'Saving…' : 'Save bid line'}</button>
              </div>
            </section>
          ) : null}

          {linesLoading ? <p className="import-empty-state">Loading existing lines…</p> : existingLines.length ? (
            <div className="import-table-wrap import-line-manager-table">
              <table>
                <thead>
                  <tr>
                    {sortableHeader('display_order', 'Order')}
                    {sortableHeader('line_code', 'Line')}
                    {sortableHeader('section', 'Section')}
                    {sortableHeader('pattern', 'Pattern')}
                    {sortableHeader('mid', 'Mid')}
                    {DAY_LABELS.map((day, dayIndex) => sortableHeader(`day-${dayIndex}`, day))}
                    {sortableHeader('status', 'Status')}
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedExistingLines.map((line, index) => {
                    const protectedLine = line.status !== 'open' || Boolean(line.assigned_bidder_id)
                    const days = daysForLine(line)
                    const manualOrderActive = lineSort.key === 'display_order' && lineSort.direction === 'asc'
                    return (
                      <tr key={line.id}>
                        <td>
                          <div className="bid-line-order-buttons">
                            <button type="button" disabled={!manualOrderActive || index === 0 || reorderingLineId !== null} onClick={() => void moveBidLine(line.id, -1)} aria-label={`Move line ${line.line_code} up`}>↑</button>
                            <button type="button" disabled={!manualOrderActive || index === sortedExistingLines.length - 1 || reorderingLineId !== null} onClick={() => void moveBidLine(line.id, 1)} aria-label={`Move line ${line.line_code} down`}>↓</button>
                          </div>
                        </td>
                        <td><strong>{line.line_code}</strong></td>
                        <td>{line.line_type === 'CPC' ? 'CPC' : line.pattern === 'D-DEV' ? 'D-Dev' : 'R-Dev'}</td>
                        <td>{line.pattern}</td>
                        <td>{line.mid === 'BID' ? 'Yes' : 'No'}</td>
                        {days.map((day, dayIndex) => <td className={day === 'RDO' ? 'rdo' : ''} key={`${line.id}-${dayIndex}`}>{day}</td>)}
                        <td>{protectedLine ? `${line.status} · protected` : 'Open'}</td>
                        <td className="import-line-action-cell">
                          <button className="button secondary compact" type="button" disabled={savingLine} onClick={() => startEditingLine(line)}>Edit</button>
                          <button
                            className="button danger compact"
                            type="button"
                            disabled={protectedLine || deletingLineId !== null}
                            title={protectedLine ? 'Assigned, taken, and locked lines cannot be deleted.' : `Delete line ${line.line_code}`}
                            onClick={() => void deleteBidLine(line)}
                          >
                            {deletingLineId === line.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="import-empty-state">No bid lines exist for this year and area.</p>}
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
