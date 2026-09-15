'use client'

import Link from 'next/link'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { getSupabaseEnv } from '@/lib/env'

type AccessState = 'checking' | 'admin' | 'signed-out' | 'denied' | 'error'
type FaqEntry = {
  id: string
  question: string
  answer: string
  display_order: number
  published: boolean
}
type MouDocument = {
  id: string
  title: string
  description: string | null
  file_path: string
  file_url: string | null
  display_order: number
  published: boolean
}

const MOU_BUCKET = 'mou-documents'

declare global {
  interface Window {
    __zlaFaqSupabase?: SupabaseClient
  }
}

function browserClient() {
  if (window.__zlaFaqSupabase) return window.__zlaFaqSupabase

  const { url, publishableKey } = getSupabaseEnv()
  window.__zlaFaqSupabase = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return window.__zlaFaqSupabase
}

function nextOrder(items: { display_order: number }[]) {
  return items.length ? Math.max(...items.map((item) => item.display_order || 0)) + 10 : 10
}

function slugFileName(fileName: string) {
  const [baseName, ...extensionParts] = fileName.split('.')
  const extension = extensionParts.length ? `.${extensionParts.pop()}` : ''
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'mou'
  return `${slug}-${Date.now()}${extension.toLowerCase()}`
}

function documentUrl(client: SupabaseClient, document: MouDocument) {
  if (document.file_url) return document.file_url
  return client.storage.from(MOU_BUCKET).getPublicUrl(document.file_path).data.publicUrl
}

export function FaqAdmin() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [access, setAccess] = useState<AccessState>('checking')
  const [entries, setEntries] = useState<FaqEntry[]>([])
  const [documents, setDocuments] = useState<MouDocument[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docDescription, setDocDescription] = useState('')
  const [docFile, setDocFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const publishedEntries = useMemo(() => entries.filter((entry) => entry.published).length, [entries])
  const publishedDocuments = useMemo(() => documents.filter((document) => document.published).length, [documents])

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

      setAccess('admin')
      await loadContent(client, active)
    }

    void initialize()
    return () => { active = false }
  }, [])

  async function loadContent(client = supabase, active = true) {
    if (!client) return
    const [entriesResult, documentsResult] = await Promise.all([
      client.from('faq_entries').select('id,question,answer,display_order,published').order('display_order').order('created_at'),
      client.from('mou_documents').select('id,title,description,file_path,file_url,display_order,published').order('display_order').order('created_at'),
    ])
    if (!active) return
    if (entriesResult.error || documentsResult.error) {
      setStatus(entriesResult.error?.message || documentsResult.error?.message || 'FAQ content could not be loaded.')
      setAccess('error')
      return
    }
    setEntries((entriesResult.data || []) as FaqEntry[])
    setDocuments((documentsResult.data || []) as MouDocument[])
  }

  async function addEntry() {
    if (!supabase) return
    const cleanQuestion = question.trim()
    const cleanAnswer = answer.trim()
    if (!cleanQuestion || !cleanAnswer) {
      setStatus('Add both a question and an answer.')
      return
    }

    setBusy(true)
    setStatus('Saving FAQ item...')
    const { error } = await supabase.from('faq_entries').insert({
      question: cleanQuestion,
      answer: cleanAnswer,
      display_order: nextOrder(entries),
      published: true,
    })
    if (error) {
      setStatus(error.message)
    } else {
      setQuestion('')
      setAnswer('')
      setStatus('FAQ item saved.')
      await loadContent()
    }
    setBusy(false)
  }

  async function updateEntry(entry: FaqEntry, changes: Partial<FaqEntry>) {
    if (!supabase) return
    setBusy(true)
    setStatus('Updating FAQ item...')
    const { error } = await supabase
      .from('faq_entries')
      .update(changes)
      .eq('id', entry.id)
    setStatus(error ? error.message : 'FAQ item updated.')
    if (!error) await loadContent()
    setBusy(false)
  }

  async function deleteEntry(entry: FaqEntry) {
    if (!supabase || !window.confirm(`Delete "${entry.question}"?`)) return
    setBusy(true)
    setStatus('Deleting FAQ item...')
    const { error } = await supabase.from('faq_entries').delete().eq('id', entry.id)
    setStatus(error ? error.message : 'FAQ item deleted.')
    if (!error) await loadContent()
    setBusy(false)
  }

  async function addDocument() {
    if (!supabase) return
    const cleanTitle = docTitle.trim()
    const cleanDescription = docDescription.trim()
    if (!cleanTitle || !docFile) {
      setStatus('Add a document title and choose the MOU file.')
      return
    }

    setBusy(true)
    setStatus('Uploading MOU...')
    const filePath = `mous/${slugFileName(docFile.name)}`
    const upload = await supabase.storage.from(MOU_BUCKET).upload(filePath, docFile, {
      cacheControl: '3600',
      upsert: false,
    })
    if (upload.error) {
      setStatus(upload.error.message)
      setBusy(false)
      return
    }

    const { data: publicUrlData } = supabase.storage.from(MOU_BUCKET).getPublicUrl(filePath)
    const { error } = await supabase.from('mou_documents').insert({
      title: cleanTitle,
      description: cleanDescription || null,
      file_path: filePath,
      file_url: publicUrlData.publicUrl,
      display_order: nextOrder(documents),
      published: true,
    })

    if (error) {
      setStatus(error.message)
    } else {
      setDocTitle('')
      setDocDescription('')
      setDocFile(null)
      const input = document.querySelector<HTMLInputElement>('[data-mou-file-input]')
      if (input) input.value = ''
      setStatus('MOU uploaded.')
      await loadContent()
    }
    setBusy(false)
  }

  async function updateDocument(document: MouDocument, changes: Partial<MouDocument>) {
    if (!supabase) return
    setBusy(true)
    setStatus('Updating MOU...')
    const { error } = await supabase
      .from('mou_documents')
      .update(changes)
      .eq('id', document.id)
    setStatus(error ? error.message : 'MOU updated.')
    if (!error) await loadContent()
    setBusy(false)
  }

  async function deleteDocument(document: MouDocument) {
    if (!supabase || !window.confirm(`Delete "${document.title}"?`)) return
    setBusy(true)
    setStatus('Deleting MOU...')
    const remove = await supabase.storage.from(MOU_BUCKET).remove([document.file_path])
    const { error } = await supabase.from('mou_documents').delete().eq('id', document.id)
    setStatus(remove.error?.message || error?.message || 'MOU deleted.')
    if (!error) await loadContent()
    setBusy(false)
  }

  if (access !== 'admin') {
    const message = access === 'checking'
      ? 'Checking administrator access...'
      : access === 'signed-out'
        ? 'Sign in through the bidding site before opening the FAQ editor.'
        : access === 'denied'
          ? 'This page is restricted to system administrators.'
          : status || 'Administrator access could not be verified.'

    return (
      <main className="import-shell import-access-shell">
        <section className="import-card import-access-card">
          <p className="eyebrow">FAQ administration</p>
          <h1>{access === 'checking' ? 'One moment.' : 'Access required.'}</h1>
          <p className="import-lede">{message}</p>
          <Link className="button primary" href="/bidding.html?page=admin">Return to bidding</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="import-shell faq-admin-shell">
      <nav className="import-nav">
        <Link className="brand" href="/bidding.html?page=admin">ZLA Bidding</Link>
        <Link className="text-button" href="/bidding.html?page=admin">Back to Admin Console</Link>
      </nav>

      <header className="import-hero">
        <div>
          <p className="eyebrow">System administration</p>
          <h1>FAQ & MOUs.</h1>
          <p className="import-lede">Publish frequently asked questions and upload MOU documents for the public bidding FAQ page.</p>
        </div>
        <div className="faq-admin-stats" aria-label="Published content summary">
          <div><strong>{publishedEntries}</strong><span>FAQs live</span></div>
          <div><strong>{publishedDocuments}</strong><span>MOUs live</span></div>
        </div>
      </header>

      <div className="faq-admin-grid">
        <section className="import-card faq-editor-card" aria-labelledby="faq-add-heading">
          <div className="import-section-heading">
            <div>
              <span>1</span>
              <div>
                <h2 id="faq-add-heading">Add a question</h2>
                <p>The answer can be plain text with multiple paragraphs.</p>
              </div>
            </div>
          </div>
          <label>
            Question
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should members know?" />
          </label>
          <label>
            Answer
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={8} placeholder="Write the answer exactly as it should appear." />
          </label>
          <button className="button primary" type="button" disabled={busy} onClick={() => void addEntry()}>Publish FAQ</button>
        </section>

        <section className="import-card faq-editor-card" aria-labelledby="mou-add-heading">
          <div className="import-section-heading">
            <div>
              <span>2</span>
              <div>
                <h2 id="mou-add-heading">Upload an MOU</h2>
                <p>PDFs, Word docs, spreadsheets, and text files can be listed.</p>
              </div>
            </div>
          </div>
          <label>
            Document title
            <input value={docTitle} onChange={(event) => setDocTitle(event.target.value)} placeholder="2027 Annual Leave MOU" />
          </label>
          <label>
            Short note
            <textarea value={docDescription} onChange={(event) => setDocDescription(event.target.value)} rows={4} placeholder="Optional context for this document." />
          </label>
          <label>
            File
            <input data-mou-file-input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => setDocFile(event.target.files?.[0] || null)} />
            <small>{docFile ? `${docFile.name} · ${(docFile.size / 1024).toFixed(1)} KB` : 'Choose the MOU file to upload.'}</small>
          </label>
          <button className="button primary" type="button" disabled={busy} onClick={() => void addDocument()}>Upload MOU</button>
        </section>
      </div>

      {status ? <p className="import-status" role="status">{status}</p> : null}

      <section className="import-card faq-list-card" aria-labelledby="faq-list-heading">
        <div className="import-section-heading">
          <div>
            <span>3</span>
            <div>
              <h2 id="faq-list-heading">Published questions</h2>
              <p>Edit text, ordering, and visibility.</p>
            </div>
          </div>
        </div>
        <div className="faq-admin-list">
          {entries.map((entry) => (
            <article className="faq-admin-row" key={entry.id}>
              <label>
                Question
                <input defaultValue={entry.question} onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value && value !== entry.question) void updateEntry(entry, { question: value })
                }} />
              </label>
              <label>
                Answer
                <textarea defaultValue={entry.answer} rows={5} onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value && value !== entry.answer) void updateEntry(entry, { answer: value })
                }} />
              </label>
              <div className="faq-admin-row-actions">
                <label>
                  Order
                  <input type="number" defaultValue={entry.display_order} onBlur={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value !== entry.display_order) void updateEntry(entry, { display_order: value })
                  }} />
                </label>
                <label className="faq-checkbox">
                  <input type="checkbox" checked={entry.published} onChange={(event) => void updateEntry(entry, { published: event.target.checked })} />
                  Published
                </label>
                <button className="button secondary" type="button" disabled={busy} onClick={() => void deleteEntry(entry)}>Delete</button>
              </div>
            </article>
          ))}
          {entries.length ? null : <p className="muted">No FAQ items yet.</p>}
        </div>
      </section>

      <section className="import-card faq-list-card" aria-labelledby="mou-list-heading">
        <div className="import-section-heading">
          <div>
            <span>4</span>
            <div>
              <h2 id="mou-list-heading">Published MOUs</h2>
              <p>Manage document labels, ordering, and visibility.</p>
            </div>
          </div>
        </div>
        <div className="faq-admin-list">
          {documents.map((document) => (
            <article className="faq-admin-row" key={document.id}>
              <label>
                Title
                <input defaultValue={document.title} onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value && value !== document.title) void updateDocument(document, { title: value })
                }} />
              </label>
              <label>
                Short note
                <textarea defaultValue={document.description || ''} rows={3} onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== (document.description || '')) void updateDocument(document, { description: value || null })
                }} />
              </label>
              <div className="faq-admin-row-actions">
                <a className="button secondary" href={supabase ? documentUrl(supabase, document) : '#'} target="_blank" rel="noreferrer">Open file</a>
                <label>
                  Order
                  <input type="number" defaultValue={document.display_order} onBlur={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value !== document.display_order) void updateDocument(document, { display_order: value })
                  }} />
                </label>
                <label className="faq-checkbox">
                  <input type="checkbox" checked={document.published} onChange={(event) => void updateDocument(document, { published: event.target.checked })} />
                  Published
                </label>
                <button className="button secondary" type="button" disabled={busy} onClick={() => void deleteDocument(document)}>Delete</button>
              </div>
            </article>
          ))}
          {documents.length ? null : <p className="muted">No MOU documents yet.</p>}
        </div>
      </section>
    </main>
  )
}
