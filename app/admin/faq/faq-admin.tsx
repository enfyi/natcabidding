'use client'

import Link from 'next/link'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
const RICH_TEXT_TAGS = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'H3', 'H4', 'BLOCKQUOTE', 'SPAN'])
const RICH_TEXT_FONT_SIZES = new Set(['0.75rem', '0.875rem', '1rem', '1.125rem', '1.25rem', '1.5rem', '2rem'])

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

function plainTextMarkup(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function safeRichTextColor(value: string) {
  const color = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  if (/^rgba?\(\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color)) return color
  return ''
}

function safeRichTextStyle(element: Element) {
  if (!(element instanceof HTMLElement) || element.tagName !== 'SPAN') return ''
  const declarations: string[] = []
  const fontSize = element.style.fontSize.trim().toLowerCase()
  const color = safeRichTextColor(element.style.color)
  if (RICH_TEXT_FONT_SIZES.has(fontSize)) declarations.push(`font-size: ${fontSize}`)
  if (color) declarations.push(`color: ${color}`)
  return declarations.join('; ')
}

function sanitizeRichHtml(value: string) {
  const parser = new DOMParser()
  const document = parser.parseFromString(value, 'text/html')
  const elements = Array.from(document.body.querySelectorAll('*'))

  elements.forEach((element) => {
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
      element.remove()
      return
    }

    if (!RICH_TEXT_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      return
    }

    const href = element.tagName === 'A' ? element.getAttribute('href')?.trim() || '' : ''
    const inlineStyle = safeRichTextStyle(element)
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name))
    if (element.tagName === 'A') {
      if (/^(https?:|mailto:|tel:|\/)/i.test(href)) {
        element.setAttribute('href', href)
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noopener noreferrer')
      }
    }
    if (element.tagName === 'SPAN' && inlineStyle) element.setAttribute('style', inlineStyle)
  })

  return document.body.innerHTML.trim()
}

function normalizedRichHtml(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const hasSupportedMarkup = /<\/?(?:p|div|br|strong|b|em|i|u|ul|ol|li|a|h3|h4|blockquote|span)\b/i.test(trimmed)
  return sanitizeRichHtml(hasSupportedMarkup ? trimmed : plainTextMarkup(trimmed))
}

function hasRichText(value: string) {
  const document = new DOMParser().parseFromString(value, 'text/html')
  return Boolean(document.body.textContent?.trim())
}

type HtmlEditorProps = {
  value: string
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  placeholder: string
  ariaLabel: string
}

function HtmlEditor({ value, onChange, onCommit, placeholder, ariaLabel }: HtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastEmittedValueRef = useRef<string | null>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const [html, setHtml] = useState(() => normalizedRichHtml(value))
  const [sourceMode, setSourceMode] = useState(false)
  const [fontSizeSelection, setFontSizeSelection] = useState('')
  const [textColor, setTextColor] = useState('#244c38')

  useEffect(() => {
    if (value === lastEmittedValueRef.current) return
    const nextHtml = normalizedRichHtml(value)
    setHtml(nextHtml)
    if (editorRef.current && editorRef.current.innerHTML !== nextHtml) editorRef.current.innerHTML = nextHtml
  }, [value])

  useEffect(() => {
    if (!sourceMode && editorRef.current && editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html
  }, [html, sourceMode])

  function emit(nextHtml: string) {
    lastEmittedValueRef.current = nextHtml
    setHtml(nextHtml)
    onChange?.(nextHtml)
  }

  function commit(nextValue = html) {
    const cleanHtml = normalizedRichHtml(nextValue)
    emit(cleanHtml)
    if (editorRef.current && editorRef.current.innerHTML !== cleanHtml) editorRef.current.innerHTML = cleanHtml
    onCommit?.(cleanHtml)
  }

  function rememberSelection() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !editorRef.current) return
    const range = selection.getRangeAt(0)
    if (editorRef.current.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange()
  }

  function restoreSelection() {
    const range = savedRangeRef.current
    if (!range) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  function runCommand(command: string, commandValue?: string) {
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand(command, false, commandValue)
    emit(editorRef.current?.innerHTML || '')
  }

  function normalizeEditorFontTags(fontSize?: string) {
    editorRef.current?.querySelectorAll('font').forEach((font) => {
      const span = document.createElement('span')
      const color = safeRichTextColor(font.getAttribute('color') || '')
      if (fontSize && RICH_TEXT_FONT_SIZES.has(fontSize)) span.style.fontSize = fontSize
      if (color) span.style.color = color
      span.append(...Array.from(font.childNodes))
      font.replaceWith(span)
    })
  }

  function applyFontSize(fontSize: string) {
    if (!RICH_TEXT_FONT_SIZES.has(fontSize)) return
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand('fontSize', false, '7')
    normalizeEditorFontTags(fontSize)
    emit(editorRef.current?.innerHTML || '')
  }

  function applyTextColor(color: string) {
    const safeColor = safeRichTextColor(color)
    if (!safeColor) return
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand('foreColor', false, safeColor)
    normalizeEditorFontTags()
    emit(editorRef.current?.innerHTML || '')
  }

  function addLink() {
    const href = window.prompt('Paste the website or email link:')?.trim()
    if (!href) return
    const safeHref = /^(https?:|mailto:|tel:|\/)/i.test(href) ? href : `https://${href}`
    runCommand('createLink', safeHref)
  }

  function selectedListItem() {
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
    const listItem = anchorElement?.closest('li')
    return listItem instanceof HTMLLIElement && editorRef.current?.contains(listItem) ? listItem : null
  }

  function indentListItem() {
    const listItem = selectedListItem()
    const parentList = listItem?.parentElement
    const previousItem = listItem?.previousElementSibling
    if (!listItem || !parentList || !(previousItem instanceof HTMLLIElement)) return
    if (parentList.tagName !== 'UL' && parentList.tagName !== 'OL') return

    let nestedList = Array.from(previousItem.children).find((child) => child.tagName === parentList.tagName)
    if (!nestedList) {
      nestedList = document.createElement(parentList.tagName.toLowerCase())
      previousItem.append(nestedList)
    }
    nestedList.append(listItem)
    editorRef.current?.focus()
    emit(editorRef.current?.innerHTML || '')
  }

  function outdentListItem() {
    const listItem = selectedListItem()
    const parentList = listItem?.parentElement
    const parentItem = parentList?.parentElement
    const outerList = parentItem?.parentElement
    if (!listItem || !parentList || !(parentItem instanceof HTMLLIElement) || !outerList) return
    if (outerList.tagName !== 'UL' && outerList.tagName !== 'OL') return

    outerList.insertBefore(listItem, parentItem.nextSibling)
    if (!parentList.children.length) parentList.remove()
    editorRef.current?.focus()
    emit(editorRef.current?.innerHTML || '')
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    if (!selectedListItem()) return

    event.preventDefault()
    if (event.shiftKey) outdentListItem()
    else indentListItem()
  }

  function toggleSourceMode() {
    if (sourceMode) {
      const cleanHtml = normalizedRichHtml(html)
      emit(cleanHtml)
    } else {
      emit(editorRef.current?.innerHTML || html)
    }
    setSourceMode((current) => !current)
  }

  return (
    <div className="html-editor">
      <div className="html-editor-toolbar" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('formatBlock', 'p')} title="Paragraph">P</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('formatBlock', 'h3')} title="Heading">H</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')} title="Bold"><strong>B</strong></button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')} title="Italic"><em>I</em></button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('underline')} title="Underline"><u>U</u></button>
        <select
          className="html-editor-select"
          value={fontSizeSelection}
          disabled={sourceMode}
          aria-label="Font size"
          title="Font size"
          onMouseDown={rememberSelection}
          onChange={(event) => {
            const fontSize = event.target.value
            setFontSizeSelection(fontSize)
            applyFontSize(fontSize)
            setFontSizeSelection('')
          }}
        >
          <option value="">Size</option>
          <option value="0.75rem">Small</option>
          <option value="0.875rem">Compact</option>
          <option value="1rem">Normal</option>
          <option value="1.125rem">Medium</option>
          <option value="1.25rem">Large</option>
          <option value="1.5rem">Larger</option>
          <option value="2rem">Largest</option>
        </select>
        <label className="html-editor-color" title="Text color">
          <span>Color</span>
          <input
            type="color"
            value={textColor}
            disabled={sourceMode}
            aria-label="Text color"
            onMouseDown={rememberSelection}
            onChange={(event) => {
              const color = event.target.value
              setTextColor(color)
              applyTextColor(color)
            }}
          />
        </label>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertUnorderedList')} title="Bulleted list">• List</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertOrderedList')} title="Numbered list">1. List</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={indentListItem} title="Nest list item">↳ Indent</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={outdentListItem} title="Move list item out one level">↰ Outdent</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={addLink} title="Add link">Link</button>
        <button type="button" disabled={sourceMode} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('removeFormat')} title="Clear formatting">Clear</button>
        <button className="html-editor-source-toggle" type="button" aria-pressed={sourceMode} onClick={toggleSourceMode}>{sourceMode ? 'Visual' : 'HTML'}</button>
      </div>
      {sourceMode ? (
        <textarea
          className="html-editor-source"
          value={html}
          rows={8}
          aria-label={`${ariaLabel} HTML source`}
          spellCheck={false}
          onChange={(event) => emit(event.target.value)}
          onBlur={() => commit()}
        />
      ) : (
        <div
          ref={editorRef}
          className="html-editor-content"
          contentEditable
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="true"
          data-placeholder={placeholder}
          suppressContentEditableWarning
          onInput={(event) => {
            rememberSelection()
            emit(event.currentTarget.innerHTML)
          }}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onKeyDown={handleEditorKeyDown}
          onBlur={(event) => commit(event.currentTarget.innerHTML)}
        />
      )}
    </div>
  )
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
    const cleanAnswer = normalizedRichHtml(answer)
    if (!cleanQuestion || !hasRichText(cleanAnswer)) {
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
    const cleanDescription = normalizedRichHtml(docDescription)
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
                <p>Format the answer visually, or switch to HTML when you need precise control.</p>
              </div>
            </div>
          </div>
          <label>
            Question
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should members know?" />
          </label>
          <div className="faq-field">
            <span className="faq-field-label">Answer</span>
            <HtmlEditor value={answer} onChange={setAnswer} placeholder="Write the answer exactly as it should appear." ariaLabel="New FAQ answer" />
          </div>
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
          <div className="faq-field">
            <span className="faq-field-label">Short note</span>
            <HtmlEditor value={docDescription} onChange={setDocDescription} placeholder="Optional context for this document." ariaLabel="New MOU note" />
          </div>
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
              <div className="faq-field">
                <span className="faq-field-label">Answer</span>
                <HtmlEditor
                  value={entry.answer}
                  placeholder="Write the answer exactly as it should appear."
                  ariaLabel={`Answer for ${entry.question}`}
                  onCommit={(value) => {
                    if (hasRichText(value) && value !== normalizedRichHtml(entry.answer)) void updateEntry(entry, { answer: value })
                  }}
                />
              </div>
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
              <div className="faq-field">
                <span className="faq-field-label">Short note</span>
                <HtmlEditor
                  value={document.description || ''}
                  placeholder="Optional context for this document."
                  ariaLabel={`Note for ${document.title}`}
                  onCommit={(value) => {
                    if (value !== normalizedRichHtml(document.description || '')) void updateDocument(document, { description: value || null })
                  }}
                />
              </div>
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
