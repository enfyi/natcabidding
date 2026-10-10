'use client'

import { ARCHIVE_KINDS, type ArchiveDocument } from '@/lib/previous-years'

type Props = {
  documents: ArchiveDocument[]
  areas: { id: string; name: string }[]
  busy: boolean
  onView: (document: ArchiveDocument) => void
}

export function ArchivePreviewCards({ documents, areas, busy, onView }: Props) {
  const years = [...new Set(documents.map((entry) => entry.archive_year))].sort((a, b) => b - a)
  return <div className="archive-public-preview">
    <h2>Previous Years</h2>
    <p>Browse historical bidding records by year and area. View read-only RDO lines and leave calendars directly on the website.</p>
    {years.map((year) => <section key={year} aria-label={`${year} archive preview`}><div className="public-archive-grid">{areas.map((area) => {
      const entries = documents.filter((entry) => entry.archive_year === year && entry.area_id === area.id)
      if (!entries.length) return null
      return <section className="public-archive-area" key={area.id}><h3>{area.name} · {year}</h3>{entries.map((entry) => <article key={entry.id}><div><h4>{ARCHIVE_KINDS[entry.document_kind]}</h4><p>{entry.file_name}</p><small>Tabs: {entry.sheet_names.join(', ')}</small></div><button className="button secondary" type="button" disabled={busy} onClick={() => onView(entry)}>Preview Page</button></article>)}</section>
    })}</div></section>)}
    {!documents.length && <p>No workbooks to preview. Import an Excel workbook as a draft first.</p>}
  </div>
}
