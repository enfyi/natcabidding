'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { announcementTitle, announcementWindow, defaultAnnouncement, fromLocalInput, safeAnnouncementUrl, toLocalInput, type Announcement, type RoundBounds } from '@/round-announcements.mjs'

type Year = { bid_year: number; is_active: boolean }
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.'
const formatTime = (time: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(time)

export function RoundAnnouncementEditor({ client }: { client: SupabaseClient }) {
  const [years, setYears] = useState<Year[]>([])
  const [year, setYear] = useState<number | null>(null)
  const [round, setRound] = useState(2)
  const [items, setItems] = useState<Announcement[]>([])
  const [schedule, setSchedule] = useState<RoundBounds[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<Announcement | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const result = await client.rpc('read_bid_year_catalog')
        if (result.error) throw result.error
        if (!active) return
        const catalog = (result.data || []) as Year[]
        setYears(catalog)
        setYear(catalog.find(item => item.is_active)?.bid_year ?? catalog[0]?.bid_year ?? null)
        if (!catalog.length) { setFailed(true); setLoading(false); setMessage('Create a bid year before configuring announcements.') }
      } catch (error) {
        if (active) { setFailed(true); setLoading(false); setMessage(errorMessage(error)) }
      }
    })()
    return () => { active = false }
  }, [client])

  useEffect(() => {
    if (!year) return
    let active = true
    setLoading(true)
    setFailed(false)
    setDraft(null)
    setMessage('')
    void (async () => {
      try {
        const [settings, times] = await Promise.all([
          client.from('round_announcements').select('*').eq('bid_year', year),
          client.rpc('read_round_announcement_schedule', { requested_bid_year: year }),
        ])
        if (settings.error || times.error) throw settings.error || times.error
        if (active) { setItems(settings.data || []); setSchedule(times.data || []) }
      } catch (error) {
        if (active) {
          setFailed(true)
          setMessage(`Announcements could not be loaded. Install the round_announcements database migration if needed, then reload. ${errorMessage(error)}`)
        }
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [client, year])

  useEffect(() => {
    if (!year || loading || failed) return
    const selected = items.find(item => item.round_number === round) || defaultAnnouncement(round, year)
    setDraft(selected)
    setStart(toLocalInput(selected.starts_at))
    setEnd(toLocalInput(selected.ends_at))
    setDirty(false)
  }, [year, round, items, loading, failed])

  function change<K extends keyof Announcement>(key: K, value: Announcement[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current)
    setDirty(true)
    setMessage('')
  }
  function canSwitch() { return !dirty || window.confirm('Discard unsaved announcement changes?') }

  let preview = draft
  let timeError = ''
  if (draft) {
    try { preview = { ...draft, starts_at: fromLocalInput(start), ends_at: fromLocalInput(end) } }
    catch (error) { timeError = error instanceof Error ? error.message : 'Invalid date.' }
  }
  const displayWindow = preview ? announcementWindow(preview, schedule) : null
  const inactiveYear = years.some(item => item.bid_year === year && !item.is_active)

  async function save() {
    if (!draft || !preview || timeError) { setMessage(timeError || 'Check the announcement.'); return }
    if (!draft.title.trim() || !draft.public_link_label.trim() || !draft.member_link_label.trim()) {
      setMessage('Enter a heading and both link labels.'); return
    }
    if (!safeAnnouncementUrl(draft.public_link_url) || !safeAnnouncementUrl(draft.member_link_url)) {
      setMessage('Use a relative site path or an absolute http:// or https:// URL for both links.'); return
    }
    if (draft.enabled && !displayWindow) {
      setMessage(draft.mode === 'manual' ? 'Choose a start and end time, with the end after the start.' : 'Automatic timing needs the previous and selected round schedules, with a gap between them. Round 1 also needs a start time.'); return
    }
    setBusy(true)
    setMessage('Saving announcement…')
    try {
      const payload = { ...preview, title: preview.title.trim(), public_link_label: preview.public_link_label.trim(), member_link_label: preview.member_link_label.trim() }
      const result = await client.from('round_announcements').upsert(payload, { onConflict: 'bid_year,round_number' }).select().single()
      if (result.error) throw result.error
      if (!result.data) throw new Error('The announcement was not saved. Check administrator access.')
      setItems(current => [...current.filter(item => item.round_number !== round), result.data as Announcement])
      setMessage(`Round ${round} announcement saved. Website updates within 30 seconds.`)
      setDirty(false)
    } catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <section className="import-card faq-editor-card announcement-editor" aria-labelledby="announcement-heading">
      <h2 id="announcement-heading">Round announcements</h2>
      <p>Manage the banner on the public website and member dashboard. Each round has its own wording, links, and schedule. All times use Los Angeles time.</p>
      <div className="announcement-fields">
        <label>Bid year<select value={year ?? ''} disabled={loading || busy} onChange={event => { if (canSwitch()) setYear(Number(event.target.value)) }}>{years.map(item => <option key={item.bid_year} value={item.bid_year}>{item.bid_year}{item.is_active ? ' · Active' : ''}</option>)}</select></label>
        <label>Round<select value={round} disabled={loading || busy} onChange={event => { if (canSwitch()) { setRound(Number(event.target.value)); setMessage('') } }}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>Round {value}</option>)}</select></label>
      </div>
      {loading ? <p role="status">Loading announcement settings…</p> : null}
      {draft && !loading && !failed ? <>
        {inactiveYear ? <p>These settings are saved for this year. Banners appear only for the active bid year.</p> : null}
        <fieldset disabled={busy}>
          <label className="faq-checkbox"><input type="checkbox" checked={draft.enabled} onChange={event => change('enabled', event.target.checked)} />Enable this round’s announcement</label>
          <div className="announcement-fields">
            <label>Color scheme<select value={draft.color} onChange={event => change('color', event.target.value as Announcement['color'])}><option value="amber">Amber</option><option value="blue">Blue</option></select></label>
            <label>Display schedule<select value={draft.mode} onChange={event => change('mode', event.target.value as Announcement['mode'])}><option value="automatic">Automatic · Between rounds</option><option value="manual">Manual · Choose dates and times</option></select></label>
          </div>
          <label>Heading<input maxLength={300} value={draft.title} onChange={event => change('title', event.target.value)} /><small>Use {'{round}'} for the round number and {'{start}'} for the scheduled start date, including “tomorrow” or “today” when applicable.</small></label>
          <label>Message<textarea rows={2} maxLength={1000} value={draft.body} onChange={event => change('body', event.target.value)} /></label>
          {draft.mode === 'automatic' ? <p>{round === 1 ? 'Round 1 appears at the start time you choose below.' : `Appears when the final bid window of Round ${round - 1} ends, across all areas.`} Disappears as soon as the first bid window of Round {round} begins. Changes to published bid times update this schedule automatically.</p> : null}
          <div className="announcement-fields">
            {draft.mode === 'manual' || round === 1 ? <label>Show from · Los Angeles<input type="datetime-local" value={start} onChange={event => { setStart(event.target.value); setDirty(true) }} /></label> : null}
            {draft.mode === 'manual' ? <label>Hide at · Los Angeles<input type="datetime-local" value={end} onChange={event => { setEnd(event.target.value); setDirty(true) }} /></label> : null}
          </div>
          <p className="announcement-window">{timeError || (displayWindow ? `Scheduled: ${formatTime(displayWindow.start)} → ${formatTime(displayWindow.end)} (Los Angeles)` : 'No valid display window. Add published bid times or choose a manual schedule.')}</p>
          <div className="announcement-fields">
            <label>Public link wording<input maxLength={100} value={draft.public_link_label} onChange={event => change('public_link_label', event.target.value)} /></label>
            <label>Public link destination<input maxLength={2000} value={draft.public_link_url} onChange={event => change('public_link_url', event.target.value)} /><small>Example: login or https://example.com/sign-in</small></label>
            <label>Dashboard link wording<input maxLength={100} value={draft.member_link_label} onChange={event => change('member_link_label', event.target.value)} /></label>
            <label>Dashboard link destination<input maxLength={2000} value={draft.member_link_url} onChange={event => change('member_link_url', event.target.value)} /><small>Example: bidding.html?page=seniority</small></label>
          </div>
        </fieldset>
        <h3>Banner preview</h3>
        <p className="muted">Preview is always shown here, even when disabled or outside its schedule.</p>
        {(['public', 'member'] as const).map(surface => <div key={surface}>
          <small>{surface === 'public' ? 'Public website' : 'Member dashboard'}</small>
          <aside className={`announcement-preview announcement-preview-${draft.color}`}>
            <span className="announcement-preview-badge">ROUND {round}</span>
            <div><strong>{announcementTitle(draft, schedule)}</strong><p>{draft.body}</p></div>
            <span className="announcement-preview-link">{draft[`${surface}_link_label`]} →</span>
          </aside>
        </div>)}
        <button className="button primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : `Save Round ${round} announcement`}</button>
        <small>Only this round is saved. Enabled announcements appear automatically during their display windows.</small>
      </> : null}
      <p role="status" aria-live="polite">{message}</p>
    </section>
  )
}
