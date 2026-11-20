'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv, withBasePath } from '@/lib/env'
import { calendarWeeks, phaseClass, PHASE_KINDS, rangeLabel, scheduleStatus, sortSchedule, validateSchedule, type ScheduleEvent } from '@/bidding-schedule.mjs'

type Year = { bid_year: number; is_active: boolean }
type Saved = { draft_events: ScheduleEvent[]; published_events: ScheduleEvent[] | null; revision: number }
let scheduleClient: SupabaseClient | undefined
const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The schedule could not be saved. Try again.'

export function BiddingScheduleAdmin() {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [access, setAccess] = useState('checking')
  const [years, setYears] = useState<Year[]>([])
  const [year, setYear] = useState(0)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [copyYear, setCopyYear] = useState('')
  const [previewDate, setPreviewDate] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!scheduleClient) { const env = getSupabaseEnv(); scheduleClient = createClient(env.url, env.publishableKey) }
        const c = scheduleClient
        const session = await c.auth.getSession()
        if (!session.data.session) { if (active) setAccess('signed-out'); return }
        const profile = await c.rpc('claim_current_bidder_profile')
        if (profile.error) throw profile.error
        if ((Array.isArray(profile.data) ? profile.data[0] : profile.data)?.role !== 'admin') { if (active) setAccess('denied'); return }
        const catalog = await c.rpc('read_bid_year_catalog')
        if (catalog.error) throw catalog.error
        if (active) {
          setClient(c); setAccess('admin'); setYears(catalog.data || [])
          setYear(catalog.data?.find((y: Year) => y.is_active)?.bid_year || catalog.data?.[0]?.bid_year || 0)
        }
      } catch (error) { if (active) { setAccess('error'); setStatus(messageOf(error)) } }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!client || !year) return
    let active = true
    setLoaded(false); setStatus('Loading schedule…'); setWarnings([]); setFile(null); setCopyYear(''); setPreviewDate('')
    void (async () => {
      const result = await client.from('bidding_schedules').select('draft_events,published_events,revision').eq('bid_year', year).maybeSingle()
      if (!active) return
      if (result.error) { setStatus(`Schedule unavailable. The annual bidding schedule migration must be installed. ${result.error.message}`); return }
      setSaved(result.data); setEvents(result.data?.draft_events || []); setDirty(false); setLoaded(true); setStatus('')
    })()
    return () => { active = false }
  }, [client, year])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  function edit(next: ScheduleEvent[]) { setEvents(next); setDirty(true); setStatus('') }
  function update(index: number, patch: Partial<ScheduleEvent>) { edit(events.map((entry, i) => i === index ? { ...entry, ...patch } : entry)) }
  const issues = validateSchedule(events)
  const summary = scheduleStatus(events.filter(e => e.start && e.end), previewDate || undefined)
  const activeYear = years.find(y => y.bid_year === year)?.is_active

  async function importExcel() {
    if (!client || !file) return
    if (dirty && !window.confirm('Replace unsaved entries with this workbook?')) return
    setBusy(true); setStatus('Reading Excel calendar…')
    try {
      const session = await client.auth.getSession()
      if (!session.data.session) throw new Error('Sign in again to import the schedule.')
      const body = new FormData(); body.append('file', file)
      const response = await fetch(withBasePath('/api/admin/bidding-schedule/preview'), { method: 'POST', headers: { Authorization: `Bearer ${session.data.session.access_token}` }, body, signal: AbortSignal.timeout(60000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      edit(result.events); setWarnings(result.warnings); setStatus(`Imported ${result.events.length} entries from ${result.sheet}. Review the dates, then save or publish.`)
    } catch (error) { setStatus(messageOf(error)) }
    finally { setBusy(false) }
  }

  async function copyPrevious() {
    if (!client || !copyYear) return
    if (dirty && !window.confirm('Replace unsaved entries with the selected year?')) return
    setBusy(true)
    try {
      const result = await client.from('bidding_schedules').select('draft_events').eq('bid_year', Number(copyYear)).maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error('That year has no saved schedule yet.')
      const shift = (value: string) => {
        const date = new Date(`${value}T12:00:00Z`)
        const month = date.getUTCMonth()
        date.setUTCFullYear(date.getUTCFullYear() + year - Number(copyYear))
        if (date.getUTCMonth() !== month) date.setUTCDate(0)
        return date.toISOString().slice(0, 10)
      }
      edit(result.data.draft_events.map((e: ScheduleEvent) => ({ ...e, start: shift(e.start), end: shift(e.end) })))
      setWarnings(['Dates were shifted by the difference in bid years. Review weekdays, holidays, and round boundaries before publishing.'])
      setStatus('Copied into the editor. Changes have not been saved.')
    } catch (error) { setStatus(messageOf(error)) }
    finally { setBusy(false) }
  }

  async function save(action: 'draft' | 'publish' | 'unpublish') {
    if (!client || !loaded || (action !== 'unpublish' && issues.length)) return
    setBusy(true); setStatus('Saving schedule…')
    try {
      const draft = sortSchedule(events)
      const payload = action === 'unpublish' ? { published_events: null, revision: (saved?.revision || 0) + 1, updated_at: new Date().toISOString() }
        : { draft_events: draft, ...(action === 'publish' ? { published_events: draft } : {}), revision: (saved?.revision || 0) + 1, updated_at: new Date().toISOString() }
      const result = saved
        ? await client.from('bidding_schedules').update(payload).eq('bid_year', year).eq('revision', saved.revision).select('draft_events,published_events,revision').maybeSingle()
        : await client.from('bidding_schedules').insert({ bid_year: year, ...payload }).select('draft_events,published_events,revision').single()
      if (result.error) throw result.error
      if (!result.data) throw new Error('Another administrator changed this schedule. Reload the page before saving again.')
      setSaved(result.data)
      if (action !== 'unpublish') { setEvents(draft); setDirty(false) }
      setStatus(action === 'draft' ? 'Draft saved. The published schedule is unchanged.' : action === 'publish' ? (activeYear ? 'Published. The front page updates within 30 seconds.' : 'Published for this year. It will appear when this becomes the active bid year.') : 'Schedule removed from the front page. The saved draft is retained.')
    } catch (error) { setStatus(messageOf(error)) }
    finally { setBusy(false) }
  }

  if (access !== 'admin') return <main className="import-shell import-access-shell"><section className="import-card"><h1>{access === 'checking' ? 'Checking access…' : 'Administrator access required'}</h1><p>{status || (access === 'signed-out' ? 'Sign in through the bidding site to manage the annual schedule.' : 'This editor is restricted to system administrators.')}</p><Link href="/bidding.html?page=admin">Return to bidding</Link></section></main>

  return <main className="import-shell schedule-admin-shell">
    <nav className="import-nav"><Link className="brand" href="/bidding.html?page=admin">ZLA Bidding</Link><Link className="text-button" href="/bidding.html?page=admin">Back to Admin Console</Link></nav>
    <header className="import-hero"><div><p className="eyebrow">Annual setup</p><h1>Bidding Schedule</h1><p className="import-lede">Import the Excel calendar or edit dates below. Preview and publish a schedule for each bid year.</p></div></header>
    <section className="import-card faq-editor-card"><label>Bid year<select aria-label="Bid year" disabled={busy} value={year} onChange={e => { if (!dirty || window.confirm('Discard unsaved schedule changes?')) setYear(Number(e.target.value)) }}>{years.map(y => <option key={y.bid_year} value={y.bid_year}>{y.bid_year}{y.is_active ? ' · Active' : ''}</option>)}</select></label>
      {!year ? <p>Create a bid year in Bidding Setup first.</p> : <p>{activeYear ? 'This is the active bid year.' : 'This schedule will appear when this bid year is active.'} Calendar dates may fall in the preceding year. This schedule describes the bidding season; individual bid windows are managed separately.</p>}
      <p role="status" aria-live="polite">{status}</p>
    </section>
    {loaded ? <>
      <section className="import-card faq-editor-card"><h2>Start with a calendar</h2><p>Upload an updated copy of your “Schedule Print” Excel worksheet. Merged calendar bands define each phase, including holidays and validation days.</p>
        <fieldset disabled={busy}><div className="schedule-actions"><label>Excel workbook<input key={year} type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] || null)} /></label><button className="button" disabled={!file} type="button" onClick={() => void importExcel()}>Import Excel for review</button></div>
          <div className="schedule-actions"><label>Reuse another bid year<select aria-label="Reuse another bid year" value={copyYear} onChange={e => setCopyYear(e.target.value)}><option value="">Choose a year</option>{years.filter(y => y.bid_year !== year).map(y => <option key={y.bid_year}>{y.bid_year}</option>)}</select></label><button className="button" disabled={!copyYear} type="button" onClick={() => void copyPrevious()}>Copy and shift dates</button></div>
        </fieldset>
        {warnings.length ? <ul className="schedule-notices">{warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}
      </section>
      <section className="import-card faq-editor-card"><h2>Schedule entries</h2><p>Start and end dates are inclusive. Split a round into separate entries around holidays and validation days.</p>
        <fieldset disabled={busy}><div className="schedule-entry-list">{events.map((entry, index) => <div className="schedule-entry" key={index}>
          <label>Phase<input maxLength={100} value={entry.label} onChange={e => update(index, { label: e.target.value })} /></label>
          <label>Type<select value={entry.kind} onChange={e => update(index, { kind: e.target.value as ScheduleEvent['kind'] })}>{PHASE_KINDS.map(kind => <option key={kind}>{kind}</option>)}</select></label>
          <label>Start date<input type="date" value={entry.start} onChange={e => update(index, { start: e.target.value })} /></label>
          <label>End date<input type="date" value={entry.end} onChange={e => update(index, { end: e.target.value })} /></label>
          <button type="button" className="text-button" aria-label={`Remove entry ${index + 1}: ${entry.label || 'Untitled'}`} onClick={() => edit(events.filter((_, i) => i !== index))}>Remove</button>
        </div>)}</div><button type="button" className="button" disabled={events.length >= 200} onClick={() => edit([...events, { label: '', kind: 'round', start: '', end: '' }])}>Add phase</button></fieldset>
        {issues.length ? <ul className="schedule-notices">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      </section>
      <section className="import-card faq-editor-card"><h2>Front-page preview</h2><label>Preview as of date · Los Angeles<input type="date" value={previewDate} onChange={e => setPreviewDate(e.target.value)} /><small>Leave blank to use today. This date is only for the preview.</small></label>
        {!issues.length ? <><div className="schedule-summary"><p className="eyebrow">{year} Bidding Schedule</p><h3>{summary.current?.label || (summary.complete ? 'Bidding schedule complete' : 'Bidding schedule upcoming')}</h3>{summary.current ? <p>{rangeLabel(summary.current)}</p> : null}{summary.next ? <p>Up next: {summary.next.label} · {rangeLabel(summary.next)}</p> : null}</div>
          <div className="annual-schedule-calendar-scroll"><table className="annual-schedule-calendar"><caption>{year} bidding season · All dates inclusive</caption><thead><tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>{calendarWeeks(events).map(week => <tr key={week[0].date}>{week.map(day => <td className={`annual-schedule-day ${phaseClass(day.event)}`} key={day.date}><time dateTime={day.date}>{day.month}/{day.day}</time><span>{day.event?.label || ''}</span></td>)}</tr>)}</tbody></table></div></> : <p>Complete the entries above to preview the calendar.</p>}
      </section>
      <section className="import-card faq-editor-card"><h2>Save and publish</h2><p>{saved?.published_events ? 'A published schedule exists for this year. Saving a draft keeps it live until you publish the new version.' : 'This year has no published schedule yet.'}</p><div className="schedule-actions"><button className="button" disabled={busy || !!issues.length || !dirty} onClick={() => void save('draft')}>Save draft</button><button className="button primary" disabled={busy || !!issues.length} onClick={() => void save('publish')}>Publish schedule</button>{saved?.published_events ? <button className="text-button" disabled={busy} onClick={() => void save('unpublish')}>Unpublish</button> : null}</div>{dirty ? <p>Unsaved changes</p> : null}<p role="status" aria-live="polite">{status}</p></section>
    </> : null}
  </main>
}
