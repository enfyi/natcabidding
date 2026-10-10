import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { ArchiveSheet } from '@/app/components/archive-sheet'
import { getSupabaseEnv, withBasePath } from '@/lib/env'
import { ARCHIVE_KINDS, archiveYearIsValid, type ArchiveKind, type ArchiveWebWorkbook } from '@/lib/previous-years'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Previous Years | ZLA Bidding' }

export default async function PreviousYearArea({ params, searchParams }: {
  params: Promise<{ year: string; area: string }>
  searchParams: Promise<{ section?: string; sheet?: string; month?: string }>
}) {
  const [{ year, area }, query] = await Promise.all([params, searchParams])
  if (!/^\d{4}$/.test(year) || !archiveYearIsValid(Number(year)) || !/^(area-[a-f]|tmu)$/.test(area)) notFound()
  const { url, publishableKey } = getSupabaseEnv()
  // Always anonymous and uncached: publication status is checked on every page request.
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } })
  const records = await client.from('previous_year_documents').select('id,document_kind,sheet_names,areas!inner(name,code)').eq('archive_year', Number(year)).eq('areas.code', area).eq('published', true).order('document_kind')
  const nav = <nav className="historical-nav"><a className="brand" href={withBasePath('/bidding.html')}>ZLA Bidding</a><a href={withBasePath('/bidding.html?area=Previous%20Years')}>← Previous Years</a></nav>
  if (records.error) return <main className="historical-shell">{nav}<h1>Previous Years</h1><p>The archive is temporarily unavailable. Please try again shortly.</p></main>
  if (!records.data?.length) notFound()
  const entries = records.data
  const selected = entries.find((entry) => entry.document_kind === query.section) || entries.find((entry) => entry.document_kind === 'rdo') || entries[0]
  const snapshot = await client.from('previous_year_documents').select('rendered_workbook').eq('id', selected.id).eq('published', true).single()
  if (snapshot.error) return <main className="historical-shell">{nav}<h1>Archive unavailable</h1><p>This record may have been unpublished. Return to Previous Years to refresh the list.</p></main>
  const workbook = snapshot.data.rendered_workbook as ArchiveWebWorkbook | null
  const joinedArea = entries[0].areas
  const areaName = (Array.isArray(joinedArea) ? joinedArea[0] : joinedArea)?.name || area.toUpperCase()
  const sheetIndex = Math.max(0, Math.min(Math.floor(Number(query.sheet)) || 0, (workbook?.sheets.length || 1) - 1))
  const sheet = workbook?.sheets[sheetIndex]
  const month = Math.max(0, Math.min(Math.floor(Number(query.month)) || 0, (sheet?.months.length || 1) - 1))
  const path = withBasePath(`/previous-years/${year}/${area}`)
  const href = (section: string, tab = 0, monthIndex = 0) => `${path}?section=${encodeURIComponent(section)}&sheet=${tab}&month=${monthIndex}`
  return <main className="historical-shell">{nav}
    <header className="historical-heading"><div><p className="eyebrow">Previous Years · Historical records</p><h1>{areaName} <span>{year}</span></h1><p>RDO lines and leave calendars from the {year} bidding year.</p></div><span className="historical-readonly">Read-only archive</span></header>
    <nav className="historical-tabs" aria-label="Archive documents">{entries.map((entry) => <a key={entry.id} href={href(entry.document_kind)} aria-current={selected.id === entry.id ? 'page' : undefined}>{ARCHIVE_KINDS[entry.document_kind as ArchiveKind]}</a>)}</nav>
    <section className="historical-document"><div className="historical-document-heading"><h2>{ARCHIVE_KINDS[selected.document_kind as ArchiveKind]}</h2><p>{sheet?.name}</p></div>
      {workbook && workbook.sheets.length > 1 && <nav className="historical-months" aria-label="Worksheet tabs">{workbook.sheets.map((tab, index) => <a key={index} href={href(selected.document_kind, index)} aria-current={index === sheetIndex ? 'page' : undefined}>{tab.name}</a>)}</nav>}
      {selected.document_kind === 'leave' && sheet && sheet.months.length > 1 && <nav className="historical-months" aria-label="Calendar months">{sheet.months.map((part, index) => <a key={index} href={href(selected.document_kind, sheetIndex, index)} aria-current={index === month ? 'page' : undefined}>{part.label}</a>)}</nav>}
      {sheet ? <ArchiveSheet sheet={sheet} calendar={selected.document_kind === 'leave'} month={month} /> : <p>This workbook is awaiting a web version. An administrator can reimport it to make it viewable here.</p>}
    </section><p className="historical-footnote">Historical reference · Current bidding is available from the main website.</p>
  </main>
}
