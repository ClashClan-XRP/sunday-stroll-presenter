import React, { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { parse } from 'pptxtojson'
import { loadArchive, savePresentation, getPresentation, deletePresentation, newId, encodePortable, decodePortable, seedFromServer, fetchServerSession, exportSessionJson } from './lib/store'
import { generateDevotionals, detectTheme, DAYS, BOOKS, VERSIONS, formatRef, passageUrl, dayDate } from './lib/devotionals'
import { downloadPptx, downloadDevotionals } from './lib/exporters'
import { SlideStage } from './SlideStage'
import { compress, decompress, publishOnline, fetchOnline, keepAlive, deleteOnline, onlineStatus, KEEP_DAYS } from './lib/publish'
import { importSlides } from './lib/pptxImport'
import { newPairCode, normalizeCode, formatCode, validCode, CODE_LEN, startHost, startRemote, lightSlide } from './lib/remote'

// ---------- helpers ----------
const htmlToText = html => {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html.replace(/<\/p>/gi, '</p>\n').replace(/<br\s*\/?>/gi, '\n'), 'text/html')
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

const readUrl = () => {
  const q = new URLSearchParams(window.location.search)
  if (q.has('remote')) return { mode: 'remote', code: normalizeCode(q.get('remote')) }
  if (q.get('b')) { const [id, f] = q.get('b').split('.'); return { mode: 'bulletin', session: id, f: f || null, a: null, h: window.location.hash } }
  return { session: q.get('session'), mode: q.get('mode') || (q.get('session') ? 'present' : 'home'), what: q.get('what'), day: q.get('day'), noprint: q.get('noprint'), a: q.get('a'), f: q.get('f'), h: window.location.hash }
}

const base = () => `${window.location.origin}${window.location.pathname}`
// The audience QR opens the all-week bulletin. (Live slide sync is deferred - see README.)
// Short audience links keep the QR small: ?b=ID (hosted) or ?b=ID.FINGERPRINT (online copy). Old ?session=…&mode=bulletin links still work.
export const bulletinUrlFor = (id, f) => `${base()}?b=${id}${f ? `.${f}` : ''}`
const nextSunday = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return d.toISOString().slice(0, 10) }

function Header({ children, nav, viewer }) {
  return (
    <header className="header no-print">
      <div className="logo" style={{ cursor: viewer ? 'default' : 'pointer' }} onClick={() => { if (!viewer) nav({ mode: 'home' }) }}>
        <div className="logo-icon">P</div>
        Sunday Stroll Through The Week - Camp Carroll
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>{children}</div>
    </header>
  )
}

// Sermon title = the main heading for the title slide and bulletin (falls back to the title slide's subtitle).
export const sermonTitleOf = pres => pres?.sermonTitle || (pres?.slides?.[0]?.body || '').split('\n').find(l => l.trim()) || pres?.theme || pres?.title || ''

// ---------- App ----------
function App() {
  const [route, setRoute] = useState(readUrl())
  const nav = useCallback(params => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && !(k === 'mode' && v === 'home')) q.set(k, v) })
    const qs = q.toString()
    window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname)
    setRoute(readUrl())
  }, [])
  useEffect(() => {
    // popstate (back/forward) and hashchange (a share link pasted into the same tab) both re-read the URL
    const onPop = () => setRoute(readUrl())
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onPop) }
  }, [])

  const [ready, setReady] = useState(false)
  // Keep-alive for bulletins published from this browser: re-post to the relays every 20 minutes while it's open.
  useEffect(() => {
    if (['bulletin', 'devotionals', 'print', 'remote'].includes(route.mode)) return
    const run = () => keepAlive().catch(() => {})
    const t = setTimeout(run, 4000), iv = setInterval(run, 20 * 60 * 1000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [route.mode])
  // Seed the presenter archive from the hosted copies only on presenter pages. Bulletin / print / remote viewers
  // never get the archive copied into their browser, so a congregant's home page shows no Edit/Delete.
  const { mode, session } = route
  useEffect(() => {
    const viewerPage = ['bulletin', 'devotionals', 'print', 'remote'].includes(mode)
    if (viewerPage && !loadArchive().length) localStorage.setItem('ssp_viewer_v1', '1')
    const seed = mode === 'edit' || mode === 'present' || (mode === 'home' && !localStorage.getItem('ssp_viewer_v1'))
    if (seed && !ready) seedFromServer().finally(() => setReady(true)); else setReady(true)
  }, [mode])

  if (!ready) return <div className="app"><main className="main"><p className="muted">Loading…</p></main></div>
  if (mode === 'bulletin' || mode === 'devotionals') return <Bulletin key={`${session}${route.h}${route.a}${route.f}`} id={session} who={{ a: route.a, f: route.f }} nav={nav} />
  if (mode === 'print') return <PrintView key={`${session}${route.h}`} route={route} />
  if (mode === 'remote') return <RemoteControl code={route.code} />
  if (mode === 'edit') return <Editor id={session} nav={nav} />
  if (mode === 'present') return <Presenter id={session} nav={nav} />
  return <Home nav={nav} />
}

// ---------- Home: upload + archive (presenter link) ----------
function Home({ nav }) {
  const [archive, setArchive] = useState(loadArchive())
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const onUpload = async e => {
    const file = e.target.files[0]
    if (!file) return
    localStorage.removeItem('ssp_viewer_v1') // this browser is a presenter now
    setBusy(true)
    try {
      const result = await parse(await file.arrayBuffer(), { imageMode: 'base64', videoMode: 'none', audioMode: 'none' })
      const slides = await importSlides(result, htmlToText)
      const theme = detectTheme(slides)
      const pres = savePresentation({
        id: newId(), title: slides[0]?.title || file.name.replace(/\.pptx$/i, ''), fileName: file.name,
        theme, weekOf: nextSunday(), version: 'ESV', slides, devotionals: generateDevotionals(slides, theme, 'ESV'), status: 'draft', createdAt: new Date().toISOString(), publishedAt: null
      })
      nav({ session: pres.id, mode: 'edit' })
    } catch (err) {
      console.error('Parse error:', err)
      alert('Could not parse PPTX. Please try another file.')
    } finally { setBusy(false) }
  }

  const remove = id => {
    const p = getPresentation(id)
    if (!confirm(p?.online ? 'Delete this presentation and remove its online bulletin? Phones will no longer open its QR.' : 'Delete this presentation from the archive?')) return
    if (p?.online) deleteOnline(id).catch(() => {})
    deletePresentation(id); setArchive(loadArchive())
  }

  return (
    <div className="app">
      <Header nav={nav} />
      <main className="main">
        <div className="upload-area" onClick={() => fileRef.current?.click()}>
          <h2 style={{ marginBottom: '1rem' }}>{busy ? 'Reading slides…' : 'Upload Your PPTX Presentation'}</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Upload, review slides and devotionals, then publish. Styled after Proclaim.</p>
          <button className="btn">Choose PPTX File</button>
          <input ref={fileRef} data-testid="upload" type="file" accept=".pptx" style={{ display: 'none' }} onChange={onUpload} />
        </div>

        <section className="archive" data-testid="archive">
          <h2>Presentation Archive</h2>
          {archive.length === 0 ? <p className="muted">No previous presentations yet.</p> : (
            <table>
              <thead><tr><th>Title</th><th>Week of</th><th>Theme</th><th>Slides</th><th>Status</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {archive.map(p => (
                  <tr key={p.id}>
                    <td><b>{p.title}</b><div className="muted small">{p.id}</div></td>
                    <td data-label="Week of" className="small">{p.weekOf || '-'}</td>
                    <td data-label="Theme" className="small">{p.theme}</td>
                    <td data-label="Slides">{p.slides.length}</td>
                    <td><span className={`badge ${p.status}`}>{p.status === 'published' ? 'Published' : 'Draft'}</span></td>
                    <td data-label="Updated" className="small">{new Date(p.updatedAt || p.createdAt).toLocaleString()}</td>
                    <td className="row-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => nav({ session: p.id, mode: 'edit' })}>Review / Edit</button>
                      <button className="btn btn-sm" onClick={() => nav({ session: p.id, mode: 'present' })}>Present</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => nav({ session: p.id, mode: 'bulletin' })}>Bulletin</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => remove(p.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

// ---------- Structured scripture input (book / chapter / verses / version) ----------
function RefFields({ value, onChange, disabled, testid }) {
  const r = value || {}
  const set = patch => onChange({ ...r, ...patch })
  const num = v => (v === '' ? null : Math.max(1, Number(v)))
  return (
    <div className="ref-fields" data-testid={testid}>
      <select value={r.book || ''} disabled={disabled} aria-label="Book" onChange={e => set({ book: e.target.value })}>
        {BOOKS.map(b => <option key={b}>{b}</option>)}
      </select>
      <input type="number" min="1" aria-label="Chapter" title="Chapter" value={r.chapter ?? ''} disabled={disabled} onChange={e => set({ chapter: num(e.target.value) })} />
      <span>:</span>
      <input type="number" min="1" aria-label="Verse start" title="Verse start" value={r.verseStart ?? ''} disabled={disabled} onChange={e => set({ verseStart: num(e.target.value) })} />
      <span>-</span>
      <input type="number" min="1" aria-label="Verse end" title="Verse end (optional)" value={r.verseEnd ?? ''} disabled={disabled} onChange={e => set({ verseEnd: num(e.target.value) })} />
      <select value={r.version || 'ESV'} disabled={disabled} aria-label="Version" onChange={e => set({ version: e.target.value })}>
        {VERSIONS.map(v => <option key={v}>{v}</option>)}
      </select>
    </div>
  )
}

// ---------- Editor: review/adjust slides + devotionals, publish ----------
function Editor({ id, nav }) {
  const [pres, setPres] = useState(() => getPresentation(id))
  const [saved, setSaved] = useState(true)
  const [online, setOnline] = useState('')
  const audience = useAudienceUrl(pres)
  if (!pres) return <NotFound nav={nav} />
  const locked = pres.status === 'published'

  const update = patch => { setPres(p => ({ ...p, ...patch })); setSaved(false) }
  const setSlide = (i, patch) => update({ slides: pres.slides.map((s, j) => (j === i ? { ...s, ...patch, edited: ('title' in patch || 'body' in patch) ? true : s.edited } : s)) })
  const move = (i, d) => { const s = [...pres.slides]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; update({ slides: s }) }
  const removeSlide = i => update({ slides: pres.slides.filter((_, j) => j !== i) })
  const addSlide = () => update({ slides: [...pres.slides, { id: `s${Date.now()}`, title: 'New slide', body: '', notes: '', images: [] }] })
  const setDevo = (i, patch) => update({ devotionals: pres.devotionals.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  const setVersionAll = v => update({ version: v, devotionals: pres.devotionals.map(d => ({ ...d, ref: { ...d.ref, version: v } })) })
  const save = () => { setPres(savePresentation(pres)); setSaved(true) }
  const publish = async () => {
    const p = savePresentation({ ...pres, sermonTitle: sermonTitleOf(pres), status: 'published', publishedAt: new Date().toISOString() })
    setPres(p); setSaved(true)
    setOnline('Posting the bulletin online…')
    try {
      const r = await publishOnline(p)
      if (r.ok) { setPres(savePresentation({ ...p, online: r })); setOnline('') }
      else setOnline('Could not reach the free relays. The QR works on this device; use "Share bulletin link" or try Publish again.')
    } catch { setOnline('Could not post the online copy. Use "Share bulletin link" instead.') }
  }
  const unpublish = () => { setPres(savePresentation({ ...pres, status: 'draft' })); setSaved(true) }
  const removeOnline = async () => {
    if (!confirm('Remove the online bulletin? Phones that scan its QR will be told it was removed.')) return
    setOnline('Removing the online copy…')
    const r = await deleteOnline(pres.id)
    if (r.error) { setOnline(r.error); return }
    const { online: _gone, ...rest } = pres
    setPres(savePresentation({ ...rest, status: 'draft' })); setSaved(true)
    setOnline(`Removed: deletion sent to ${r.ok} of ${r.total} relays. Publish again to post a new copy.`)
  }
  const [held, setHeld] = useState(() => onlineStatus(id))
  useEffect(() => { const on = e => { if (e.detail === id) setHeld(onlineStatus(id)) }; window.addEventListener('ssp-online', on); return () => window.removeEventListener('ssp-online', on) }, [id])
  const [checking, setChecking] = useState(false)
  const checkNow = async () => { setChecking(true); try { await keepAlive(pres.id) } finally { setChecking(false); setHeld(onlineStatus(pres.id)) } }

  return (
    <div className="app">
      <Header nav={nav}>
        <button className="btn btn-secondary" onClick={() => nav({ mode: 'home' })}>Archive</button>
        <button className="btn btn-secondary" onClick={save} disabled={saved}>{saved ? 'Saved' : 'Save draft'}</button>
        {locked
          ? <button className="btn btn-secondary" onClick={unpublish}>Unpublish to edit</button>
          : <button className="btn" data-testid="publish" onClick={() => { publish() }}>Publish</button>}
        <button className="btn" onClick={() => { save(); nav({ session: pres.id, mode: 'present' }) }}>Present</button>
      </Header>
      <main className="main">
        <div className="meta-row">
          <label>Title<input value={pres.title} disabled={locked} data-testid="title" onChange={e => update({ title: e.target.value })} /></label>
          <label>Sermon title<input value={sermonTitleOf(pres)} disabled={locked} data-testid="sermon-title" onChange={e => update({ sermonTitle: e.target.value })} /></label>
          <label>Week theme<input value={pres.theme} disabled={locked} data-testid="theme" onChange={e => update({ theme: e.target.value })} /></label>
          <label className="narrow">Sermon Sunday (week of)<input type="date" value={pres.weekOf || ''} disabled={locked} data-testid="weekof" onChange={e => update({ weekOf: e.target.value })} /></label>
          <label className="narrow">Bible version (all days)<select value={pres.version || 'ESV'} disabled={locked} data-testid="version-all" onChange={e => setVersionAll(e.target.value)}>{VERSIONS.map(v => <option key={v}>{v}</option>)}</select></label>
          <span className={`badge ${pres.status}`}>{locked ? 'Published' : 'Draft'}</span>
        </div>

        {!locked && online && <p className="host-note" data-testid="online-status">{online}</p>}
        {locked && (
          <div className="qr-section" data-testid="publish-qr">
            <h3>Published {new Date(pres.publishedAt).toLocaleString()}</h3>
            <div style={{ marginTop: '1rem' }}><QRCodeSVG value={audience.url} size={170} bgColor="#ffffff" fgColor="#0f0c29" includeMargin data-testid="publish-qr-code" /></div>
            <p className="small">Scan for this week's bulletin and daily devotionals</p>
            <p className="small muted" data-testid="audience-url">{audience.url}</p>
            <div className="host-note" data-testid="host-note">
              {audience.kind === 'hosted' && <p><b>Hosted copy found.</b> This QR works on every phone.</p>}
              {audience.kind === 'online' && <>
                <p><b>Ready for phones.</b> The QR points to the online copy on free public relays, so any phone can open it. No git or upload needed.</p>
                <p data-testid="relay-holders"><b>{held ? `Held by ${held.held} of ${held.total} relays` : 'Relay check pending'}</b>{held?.checkedAt ? ` (checked ${new Date(held.checkedAt).toLocaleTimeString()})` : ''}. While this browser is open it re-posts the bulletin every 20 minutes.
                  {' '}<button className="btn btn-secondary btn-sm" data-testid="check-relays" disabled={checking} onClick={checkNow}>{checking ? 'Checking…' : 'Check now'}</button></p>
                <p className="warn-text" data-testid="week-note">This QR is good for about a week. Free relays don't promise to keep data, so after ~{KEEP_DAYS - 1} days (or if this browser's data is cleared) it may stop opening. For a lasting copy, use Export for hosting below.</p>
                <p><button className="btn btn-secondary btn-sm" data-testid="remove-online" onClick={removeOnline}>Unpublish and remove online copy</button></p>
              </>}
              {audience.kind === 'local' && <p><b>Not online yet.</b> This QR only works in this browser until the online copy posts. Click Publish again, or use the share link below.</p>}
              <p data-testid="online-status">{online}</p>
              <p><ShareButton pres={pres} /> works on any device without any relay (the link is long, so it's for texting or email, not a QR).</p>
              <p className="small muted">For the most durable copy, you can also <button className="btn btn-sm" data-testid="export-json" onClick={() => exportSessionJson(pres)}>Export for hosting</button> and add <code>{pres.id}.json</code> to <code>public/sessions/</code>.</p>
            </div>
          </div>
        )}

        <div className="editor-grid">
          <section>
            <h2>Slides ({pres.slides.length})</h2>
            {pres.slides.map((s, i) => (
              <div className="edit-card" key={s.id}>
                <div className="edit-head"><b>Slide {i + 1}</b>
                  <span>
                    <button className="btn-icon" disabled={locked} onClick={() => move(i, -1)}>↑</button>
                    <button className="btn-icon" disabled={locked} onClick={() => move(i, 1)}>↓</button>
                    <button className="btn-icon" disabled={locked} onClick={() => removeSlide(i)}>✕</button>
                  </span>
                </div>
                <SlideStage slide={s} className="edit-preview" />
                {s.elements?.length > 0 && (s.edited
                  ? <p className="small muted">Text edited: showing simple layout. <button className="btn-icon" disabled={locked} onClick={() => setSlide(i, { edited: false, title: s.title })}>Restore original layout</button></p>
                  : <p className="small muted">Original layout and pictures kept. Editing the text switches this slide to the simple layout.</p>)}
                <input value={s.title} disabled={locked} onChange={e => setSlide(i, { title: e.target.value })} />
                <textarea rows={3} value={s.body} disabled={locked} onChange={e => setSlide(i, { body: e.target.value })} />
              </div>
            ))}
            <button className="btn btn-secondary" disabled={locked} onClick={addSlide}>+ Add slide</button>
          </section>
          <section>
            <h2>Devotionals (7 days)</h2>
            <button className="btn btn-secondary btn-sm" disabled={locked} data-testid="regen" onClick={() => update({ devotionals: generateDevotionals(pres.slides, pres.theme, pres.version || 'ESV') })}>Regenerate from slides + theme</button>
            {pres.devotionals.map((d, i) => (
              <div className="edit-card" key={d.day} data-testid={`devo-card-${i}`}>
                <div className="edit-head"><b>{d.day}</b><span className="muted small">{dayDate(pres.weekOf, i)}</span></div>
                <RefFields value={d.ref} disabled={locked} testid={`ref-${i}`} onChange={ref => setDevo(i, { ref })} />
                <input value={d.title} disabled={locked} aria-label="Devotional title" onChange={e => setDevo(i, { title: e.target.value })} />
                <textarea rows={4} value={d.reflection} disabled={locked} data-testid={`devo-${i}`} onChange={e => setDevo(i, { reflection: e.target.value })} />
                <input value={d.prayer} disabled={locked} aria-label="Prayer" onChange={e => setDevo(i, { prayer: e.target.value })} />
                <input value={d.action} disabled={locked} aria-label="Today's step" onChange={e => setDevo(i, { action: e.target.value })} />
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  )
}

// ---------- Presenter: slide controls, title-slide QR, downloads, phone remote ----------
const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N', 'MediaTrackNext']
const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P', 'MediaTrackPrevious']

function Presenter({ id, nav }) {
  const pres = getPresentation(id)
  const [idx, setIdx] = useState(0)
  const [full, setFull] = useState(false)
  const [black, setBlack] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [remote, setRemote] = useState(null) // { code, status }
  const hostRef = useRef(null)
  const touch = useRef(null)
  const total = pres?.slides.length || 0
  const audience = useAudienceUrl(pres)
  const bulletinUrl = audience.url || bulletinUrlFor(id)
  const published = pres?.status === 'published'
  const stateRef = useRef({})

  const go = d => setIdx(i => Math.min(Math.max(i + d, 0), Math.max(total - 1, 0)))
  const goto = n => setIdx(Math.min(Math.max(n, 0), Math.max(total - 1, 0)))

  // Keyboard + presentation clickers (they send PageUp/PageDown, arrows, B or . for black)
  useEffect(() => {
    const k = e => {
      if (e.target?.closest?.('input, textarea, select')) return
      if (NEXT_KEYS.includes(e.key)) { e.preventDefault(); go(1) }
      else if (PREV_KEYS.includes(e.key)) { e.preventDefault(); go(-1) }
      else if (e.key === 'Home') goto(0)
      else if (e.key === 'End') goto(total - 1)
      else if (['b', 'B', '.'].includes(e.key)) setBlack(v => !v)
      else if (e.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', k)
    const fs = () => { if (!document.fullscreenElement) setFull(false) }
    document.addEventListener('fullscreenchange', fs)
    return () => { window.removeEventListener('keydown', k); document.removeEventListener('fullscreenchange', fs) }
  }, [total])

  // Phone remote: state sent to the phone on every change
  stateRef.current = {
    idx, total, black, title: pres?.title, sermonTitle: sermonTitleOf(pres),
    cur: lightSlide(pres?.slides[idx]), next: lightSlide(pres?.slides[idx + 1]), notes: pres?.slides[idx]?.notes || '',
    titles: pres?.slides.map(s => s.title) || []
  }
  useEffect(() => { hostRef.current?.broadcast(stateRef.current) }, [idx, black])
  const launchHost = code => {
    setRemote({ code, status: { peer: 'connecting', relay: 'connecting', mqtt: 'connecting', controller: null } })
    hostRef.current = startHost(code, {
      getState: () => stateRef.current,
      onStatus: st => setRemote(r => (r && r.code === code ? { ...r, status: st } : r)),
      onCommand: m => {
        if (m.c === 'next') go(1)
        else if (m.c === 'prev') go(-1)
        else if (m.c === 'goto') goto(Number(m.slide) || 0)
        else if (m.c === 'black') setBlack(v => (typeof m.on === 'boolean' ? m.on : !v))
      }
    })
  }
  const startRemoteHost = () => {
    setRemoteOpen(true)
    if (hostRef.current) return
    let code = sessionStorage.getItem(`ssp_pair_${id}`)
    if (!code || !validCode(code)) { code = newPairCode(); sessionStorage.setItem(`ssp_pair_${id}`, code) }
    launchHost(code)
  }
  // Disconnect / New code: tells phones the session ended, then pairs fresh with a new random code.
  const rotateCode = () => {
    hostRef.current?.stop(); hostRef.current = null
    const code = newPairCode(); sessionStorage.setItem(`ssp_pair_${id}`, code)
    setRemoteOpen(true); launchHost(code)
  }
  const stopRemote = () => {
    hostRef.current?.stop(); hostRef.current = null
    sessionStorage.removeItem(`ssp_pair_${id}`); setRemote(null); setRemoteOpen(false)
  }
  useEffect(() => () => hostRef.current?.stop(), [])

  if (!pres) return <NotFound nav={nav} />
  const enterFull = () => { document.documentElement.requestFullscreen?.().catch(() => {}); setFull(true) }
  const exitFull = () => { if (document.fullscreenElement) document.exitFullscreen(); setFull(false) }
  const qr = published && idx === 0 ? bulletinUrl : null
  const remoteUrl = remote ? `${base()}?remote=${remote.code}` : ''
  const paired = !!remote?.status?.controller
  const phoneConnected = paired && Date.now() - (remote.status.lastSeen || 0) < 60 * 1000
  const statusLine = remote ? `Direct WebRTC: ${remote.status.peer} • Nostr relay: ${remote.status.relay} • MQTT: ${remote.status.mqtt}${paired ? ` • phone via ${remote.status.controllerVia || '…'}` : ''}${remote.status.rejected ? ` • ${remote.status.rejected} rejected` : ''}` : ''

  // Fullscreen: tap/click left half = back, right half = next; swipe right = back, swipe left = next
  const onStageClick = e => { const r = e.currentTarget.getBoundingClientRect(); go(e.clientX - r.left < r.width / 2 ? -1 : 1) }
  const onTouchStart = e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }
  const onTouchEnd = e => {
    const s = touch.current; touch.current = null
    if (!s) return
    const t = e.changedTouches[0]; const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); go(dx > 0 ? -1 : 1) }
  }

  return (
    <div className="app">
      <Header nav={nav}>
        <button className="btn btn-secondary" onClick={() => nav({ session: id, mode: 'edit' })}>Review / Edit</button>
        <button className="btn btn-secondary" onClick={() => nav({ session: id, mode: 'bulletin' })}>Bulletin</button>
        <button className="btn btn-secondary" data-testid="dl-pptx" onClick={() => downloadPptx(pres, published ? bulletinUrl : null)}>Download PPTX</button>
        <button className="btn btn-secondary" data-testid="dl-pdf" onClick={() => window.open(`${base()}?session=${id}&mode=print&what=slides`, '_blank')}>Download PDF</button>
        <button className="btn" data-testid="remote-btn" onClick={startRemoteHost}>📱 Remote</button>
      </Header>
      <main className="main">
        <h2 style={{ marginBottom: '1rem' }}>{pres.title} {!published && <span className="badge draft">Draft - publish to enable QR</span>}</h2>
        {remote && paired && (
          <div className="remote-bar-host" data-testid="remote-paired">
            <span className={phoneConnected ? 'ok' : ''} data-testid="host-status">{phoneConnected ? '● Phone remote connected' : '○ Phone remote paired, not heard from in a minute'} <span className="small muted">({statusLine})</span></span>
            <button className="btn btn-secondary btn-sm" data-testid="rotate-code" onClick={rotateCode}>Disconnect / New code</button>
            <button className="btn btn-secondary btn-sm" onClick={stopRemote}>Turn off remote</button>
          </div>
        )}
        {remoteOpen && remote && !paired && (
          <div className="remote-panel" data-testid="remote-panel">
            <div><QRCodeSVG value={remoteUrl} size={132} bgColor="#ffffff" fgColor="#0f0c29" includeMargin /></div>
            <div>
              <h3>Phone remote</h3>
              <p>Scan with the presenter's phone, or open <b>{base().replace(/^https?:\/\//, '')}?remote</b> and type the code. This panel hides itself once a phone pairs, and never appears in fullscreen.</p>
              <div className="pair-code" data-testid="pair-code" data-code={remote.code}>{formatCode(remote.code)}</div>
              <p className="remote-status" data-testid="host-status">○ Waiting for phone <span className="small muted">({statusLine})</span></p>
              <button className="btn btn-secondary btn-sm" onClick={() => setRemoteOpen(false)}>Hide</button>{' '}
              <button className="btn btn-secondary btn-sm" data-testid="rotate-code" onClick={rotateCode}>New code</button>
            </div>
          </div>
        )}
        <SlideStage slide={pres.slides[idx]} qr={qr} sermonTitle={idx === 0 ? sermonTitleOf(pres) : null} className="presenter-stage" testid="presenter-slide" />
        <div className="controls">
          <button className="btn btn-secondary" data-testid="prev" onClick={() => go(-1)} disabled={idx === 0}>← Previous</button>
          <span style={{ alignSelf: 'center' }} data-testid="slide-counter">Slide {idx + 1} / {total}</span>
          <button className="btn btn-secondary" data-testid="next" onClick={() => go(1)} disabled={idx === total - 1}>Next →</button>
          <button className="btn btn-secondary" onClick={() => setBlack(v => !v)}>{black ? 'Unblack' : 'Black screen (B)'}</button>
          <button className="btn" data-testid="fullscreen" onClick={enterFull}>Present Fullscreen</button>
        </div>
        {pres.slides[idx]?.notes && <div className="notes"><b>Notes:</b> {pres.slides[idx].notes}</div>}
        {published ? (
          <div className="qr-section">
            <h3 style={{ marginBottom: '1rem' }}>Scan for This Week's Bulletin</h3>
            <QRCodeSVG value={bulletinUrl} size={180} bgColor="#ffffff" fgColor="#0f0c29" includeMargin />
            <p className="small muted" style={{ marginTop: '1rem' }}>{bulletinUrl}</p>
          </div>
        ) : <div className="qr-section"><p className="muted">Publish this presentation from Review / Edit to show the audience QR code.</p></div>}
      </main>
      {black && !full && <div className="black-veil" onClick={() => setBlack(false)} />}
      {full && (
        <div className="fullscreen-overlay" data-testid="fs-overlay" onClick={onStageClick} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <SlideStage slide={pres.slides[idx]} qr={qr} sermonTitle={idx === 0 ? sermonTitleOf(pres) : null} className="fs-stage" fill />
          {black && <div className="black-veil" />}
          <div className="fs-controls" onClick={e => e.stopPropagation()}>
            <button aria-label="Previous slide" data-testid="fs-prev" onClick={() => go(-1)}>‹</button>
            <span>{idx + 1} / {total}</span>
            <button aria-label="Next slide" data-testid="fs-next" onClick={() => go(1)}>›</button>
            {remote && <span className={`dot ${phoneConnected ? 'ok' : ''}`} title={statusLine} />}
            <button aria-label="Exit fullscreen" onClick={exitFull}>✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Phone remote (?remote=CODE) ----------
function RemoteControl({ code: initial }) {
  const [code, setCode] = useState(initial && validCode(initial) ? initial : '')
  const [entered, setEntered] = useState(initial || '')
  const [state, setState] = useState(null)
  const [status, setStatus] = useState({ state: 'deriving' })
  const ref = useRef(null)
  useEffect(() => {
    if (!code) return
    setState(null)
    ref.current = startRemote(code, { onState: setState, onStatus: setStatus })
    return () => ref.current?.stop()
  }, [code])
  const send = c => ref.current?.send(c)
  if (!code) {
    const ok = validCode(entered)
    return (
      <div className="app remote-app"><main className="main">
        <h2>Sunday Stroll remote</h2>
        <p className="muted">Type the {CODE_LEN}-character code shown on the presenter laptop (dashes optional).</p>
        <input data-testid="code-input" value={formatCode(entered)} onChange={e => setEntered(normalizeCode(e.target.value).slice(0, CODE_LEN))} placeholder="XXXXXX-XXXXXX-XXXXXX" autoCapitalize="characters" autoComplete="off" style={{ fontSize: '1.2rem', letterSpacing: '0.1em', textAlign: 'center' }} />
        {initial && !validCode(initial) && <p className="error-text" data-testid="code-error">That code isn't complete or valid. Codes are {CODE_LEN} characters.</p>}
        <button className="btn" disabled={!ok} style={{ marginTop: '1rem', width: '100%' }} onClick={() => { window.history.replaceState({}, '', `?remote=${entered}`); setCode(entered) }}>Connect</button>
      </main></div>
    )
  }
  const LABEL = { deriving: 'Securing connection…', connecting: 'Connecting…', waiting: 'Pairing with the laptop…', connected: 'Connected', notfound: 'Presenter not found', busy: 'Another phone is in control', ended: 'Remote session ended', lost: 'Connection lost, re-pair' }
  const ok = status.state === 'connected'
  const bad = ['notfound', 'busy', 'ended', 'lost'].includes(status.state)
  return (
    <div className="app remote-app">
      <div className={`remote-bar ${ok ? 'ok' : bad ? 'bad' : ''}`} data-testid="remote-status" data-state={status.state}>{ok ? '● ' : '○ '}{LABEL[status.state] || status.state}{ok && status.via ? ` • ${status.via}` : ''}</div>
      <main className="main">
        {status.detail && <p className={bad ? 'error-text' : 'muted'} data-testid="remote-detail">{status.detail}</p>}
        {status.state === 'lost'
          ? <button className="btn" data-testid="r-repair" onClick={() => { ref.current?.repair(); window.location.reload() }}>Re-pair</button>
          : status.state === 'ended' || status.state === 'busy'
          ? <button className="btn" onClick={() => { window.history.replaceState({}, '', '?remote'); setCode(''); setEntered('') }}>Enter a new code</button>
          : state ? <>
          <div className="remote-title" data-testid="remote-title">{state.sermonTitle || state.title}</div>
          <div className="remote-label">Now: <b data-testid="remote-counter">{state.idx + 1} / {state.total}</b>{state.black && <span className="badge draft">BLACK</span>}</div>
          <SlideStage slide={state.cur} sermonTitle={state.idx === 0 ? state.sermonTitle : null} className="remote-cur" testid="remote-cur" />
          <div className="remote-buttons">
            <button className="btn btn-secondary big" data-testid="r-prev" onClick={() => send({ c: 'prev' })} disabled={!ok || state.idx === 0}>‹ Prev</button>
            <button className="btn big" data-testid="r-next" onClick={() => send({ c: 'next' })} disabled={!ok || state.idx >= state.total - 1}>Next ›</button>
          </div>
          <div className="remote-row">
            <button className="btn btn-secondary btn-sm" data-testid="r-black" disabled={!ok} onClick={() => send({ c: 'black' })}>{state.black ? 'Show slides' : 'Black screen'}</button>
            <select data-testid="r-goto" value={state.idx} disabled={!ok} onChange={e => send({ c: 'goto', slide: Number(e.target.value) })}>
              {state.titles.map((t, i) => <option key={i} value={i}>{i + 1}. {t}</option>)}
            </select>
          </div>
          {state.notes && <div className="notes"><b>Notes:</b> {state.notes}</div>}
          <div className="remote-label">Next:</div>
          {state.next ? <SlideStage slide={state.next} className="remote-next" /> : <p className="muted">End of presentation</p>}
        </> : !bad && <p className="muted">Waiting for the presenter laptop… Make sure the presenter page is open with its Remote panel showing this code.</p>}
        <p className="small muted" style={{ marginTop: '1.5rem' }}>Code {formatCode(code)}</p>
      </main>
    </div>
  )
}

// ---------- Client bulletin: sermon outline + devotionals all week; print/download day or week ----------
// Where a viewer's bulletin comes from, in order: share link in the hash (#z= compressed, #d= legacy),
// this browser's archive, the hosted copy (public/sessions), then the online copy on public relays (?b=ID.FP or &a=key).
function useSession(id, who = {}) {
  const hp = new URLSearchParams(window.location.hash.slice(1))
  const z = hp.get('z'), legacy = hp.get('d')
  const hash = z || legacy
  const immediate = (legacy && decodePortable(legacy)) || (!z && getPresentation(id)) || null
  const [pres, setPres] = useState(immediate)
  const [loading, setLoading] = useState(!immediate)
  const [progress, setProgress] = useState(null)
  const [failure, setFailure] = useState(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (immediate) return
    let live = true
    setLoading(true); setFailure(null)
    ;(async () => {
      let p = z ? await decompress(z) : null
      if (p) p = { ...p, id }
      if (!p && z) p = getPresentation(id)
      if (!p && id) p = await fetchServerSession(id)
      let fail = null
      if (!p && id && (who.a || who.f)) {
        const r = await fetchOnline(id, who, pr => live && setProgress(pr))
        p = r.pres; fail = r.pres ? null : r
      }
      if (live) { setPres(p); setFailure(p ? null : (fail || { reason: 'none' })); setLoading(false) }
    })()
    return () => { live = false }
  }, [id, who.a, who.f, hash, tries])
  return { pres, loading, hash, progress, failure, retry: () => setTries(t => t + 1) }
}

const FAIL_TEXT = {
  unreachable: r => `Couldn't reach any of the ${r.total} free relays that hold online bulletins. Check this phone's internet connection (some church or guest Wi-Fi blocks them; try mobile data).`,
  missing: r => `${r.reached} of ${r.total} relays answered, but none has this bulletin. It may be more than a week old, or the relays dropped it. Ask the presenter to open Sunday Stroll and publish it again, or to send the share link.`,
  deleted: () => 'The presenter removed this bulletin.',
  none: () => "This bulletin isn't available on this device yet. Ask the presenter for the share link."
}
function BulletinFailure({ failure, retry }) {
  return (
    <div className="app"><Header viewer nav={() => {}} /><main className="main">
      <p data-testid="bulletin-fail" data-reason={failure.reason}>{(FAIL_TEXT[failure.reason] || FAIL_TEXT.none)(failure)}</p>
      {failure.reason !== 'deleted' && failure.reason !== 'none' && <button className="btn" style={{ marginTop: '1rem' }} data-testid="bulletin-retry" onClick={retry}>Try again</button>}
    </main></div>
  )
}

// The link the audience QR should carry: the hosted copy if it exists, else the online (relay) copy, else local only.
function useAudienceUrl(pres) {
  const [hosted, setHosted] = useState(null)
  useEffect(() => { if (pres?.id) fetchServerSession(pres.id).then(p => setHosted(!!p)) }, [pres?.id])
  if (!pres) return { url: '', kind: 'none' }
  if (hosted) return { url: bulletinUrlFor(pres.id), kind: 'hosted' }
  if (pres.online?.f) return { url: bulletinUrlFor(pres.id, pres.online.f), kind: 'online' }
  if (pres.online?.a) return { url: `${base()}?session=${pres.id}&mode=bulletin&a=${pres.online.a}`, kind: 'online' }
  return { url: bulletinUrlFor(pres.id), kind: hosted === null ? 'checking' : 'local' }
}

async function shareLinkFor(pres) {
  return `${bulletinUrlFor(pres.id)}#z=${await compress(pres)}`
}

function ShareButton({ pres, testid = 'share-bulletin', label = 'Share bulletin link' }) {
  const [msg, setMsg] = useState('')
  const go = async () => {
    const url = await shareLinkFor(pres)
    window.__lastShareLink = url
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) { await navigator.share({ title: sermonTitleOf(pres), url }); setMsg('Shared.'); return }
      await navigator.clipboard.writeText(url); setMsg(`Link copied (${url.length.toLocaleString()} characters). Paste it in a text, email or the church group chat.`)
    } catch { setMsg('Copy failed. Long-press to copy:'); }
  }
  return <span><button className="btn btn-secondary btn-sm" data-testid={testid} onClick={go}>{label}</button> <span className="small muted" data-testid={`${testid}-msg`}>{msg}</span></span>
}

function Bulletin({ id, who, nav }) {
  const { pres, loading, hash, progress, failure, retry } = useSession(id, who)
  const a = who?.a, f = who?.f
  if (loading) return <div className="app"><main className="main"><p className="muted" data-testid="bulletin-loading">{progress ? `Looking for this week's bulletin on the free relays… (try ${progress.attempt} of ${progress.of})` : 'Loading bulletin…'}</p></main></div>
  if (!pres) return <BulletinFailure failure={failure || { reason: 'none' }} retry={retry} />
  if (!hash && pres.status !== 'published') return <ViewerMessage msg="This bulletin hasn't been published yet." />
  // Highlight today only when today falls inside this bulletin's week (Mon-Sun after the sermon Sunday).
  const todayIdx = (() => {
    if (!pres.weekOf) return (new Date().getDay() + 6) % 7
    const start = new Date(`${pres.weekOf}T00:00:00`); const diff = Math.floor((Date.now() - start) / 86400000) - 1
    return diff >= 0 && diff < 7 ? diff : -1
  })()
  const today = DAYS[todayIdx]
  const printUrl = (what, day) => `${base()}?session=${id}&mode=print&what=${what}${day !== undefined ? `&day=${day}` : ''}${a ? `&a=${a}` : ''}${f ? `&f=${f}` : ''}${window.location.hash || ''}`
  return (
    <div className="app">
      <Header nav={nav} viewer>
        <button className="btn btn-secondary" data-testid="print-week" onClick={() => window.open(printUrl('week'), '_blank')}>Print / PDF week</button>
        <button className="btn btn-secondary" data-testid="dl-week" onClick={() => downloadDevotionals(pres, pres.devotionals, 'html', 'week')}>Download week</button>
        <button className="btn btn-secondary" data-testid="dl-week-txt" onClick={() => downloadDevotionals(pres, pres.devotionals, 'txt', 'week')}>Save week (.txt)</button>
        <ShareButton pres={{ ...pres, id }} testid="copy-portable" label="Copy share link" />
      </Header>
      <main className="main devotional-page bulletin">
        <div className="bulletin-head">
          <div className="muted small">Sunday Stroll Through The Week • Camp Carroll</div>
          <h1 data-testid="bulletin-title">{sermonTitleOf(pres)}</h1>
          <div className="bulletin-sub">{pres.title}</div>
          <p className="muted">{pres.theme}{pres.weekOf ? ` • Week of ${new Date(`${pres.weekOf}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}</p>
        </div>
        {pres.slides?.length > 0 && (
          <details className="devotional-card" data-testid="outline">
            <summary><b>Order of service &amp; sermon outline</b> ({pres.slides.length - 1} items)</summary>
            <ol style={{ margin: '0.75rem 0 0 1.25rem' }}>{pres.slides.slice(1).map(s => <li key={s.id}>{s.title}</li>)}</ol>
          </details>
        )}
        {pres.devotionals.map((d, i) => (
          <div key={d.day} className={`devotional-card ${d.day === today ? 'today' : ''}`} data-testid={`day-${i}`}>
            <h2>{d.day} <span className="muted small">{dayDate(pres.weekOf, i)}</span> {d.day === today && <span className="badge published">Today</span>}</h2>
            <h3 style={{ color: 'var(--accent-green)' }}>{d.title}</h3>
            <div className="scripture"><a href={passageUrl(d.ref)} target="_blank" rel="noreferrer">{formatRef(d.ref)}</a></div>
            <p>{d.reflection}</p>
            <p style={{ marginTop: '0.5rem' }}><b>Prayer:</b> {d.prayer}</p>
            <p style={{ marginTop: '0.5rem' }}><b>Today:</b> {d.action}</p>
            <div className="row-actions" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary btn-sm" data-testid={`print-day-${i}`} onClick={() => window.open(printUrl('day', i), '_blank')}>Print day</button>
              <button className="btn btn-secondary btn-sm" data-testid={`dl-day-${i}`} onClick={() => downloadDevotionals(pres, [d], 'html', d.day)}>Download day</button>
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}

// ---------- Print view (browser print-to-PDF) ----------
function PrintView({ route }) {
  const { pres, loading } = useSession(route.session, { a: route.a, f: route.f })
  const audience = useAudienceUrl(pres ? { ...pres, id: route.session } : null)
  useEffect(() => { if (pres && !route.noprint) setTimeout(() => window.print(), 400) }, [pres])
  if (loading) return <p style={{ padding: '2rem' }}>Loading…</p>
  if (!pres) return <p style={{ padding: '2rem' }}>Nothing to print.</p>
  if (route.what === 'slides') {
    return (
      <div className="print-root">
        {pres.slides.map((s, i) => (
          <div className="print-slide" key={s.id}>
            <SlideStage slide={s} qr={i === 0 && pres.status === 'published' ? audience.url : null} sermonTitle={i === 0 ? sermonTitleOf(pres) : null} className="print-stage" />
            <div className="ps-foot">{pres.title} • {i + 1}/{pres.slides.length}</div>
          </div>
        ))}
      </div>
    )
  }
  const idxs = route.what === 'day' ? [Number(route.day) || 0] : pres.devotionals.map((_, i) => i)
  return (
    <div className="print-root print-devos">
      <h1>{sermonTitleOf(pres)}</h1><p>{pres.title} • <i>{pres.theme}</i></p>
      {idxs.map(i => { const d = pres.devotionals[i]; return (
        <section key={d.day}><h2>{d.day}{pres.weekOf ? ` (${dayDate(pres.weekOf, i)})` : ''}: {d.title}</h2><p className="ref">{formatRef(d.ref)}</p><p>{d.reflection}</p><p><b>Prayer:</b> {d.prayer}</p><p><b>Today:</b> {d.action}</p></section>
      ) })}
    </div>
  )
}

function ViewerMessage({ msg }) {
  return <div className="app"><Header viewer nav={() => {}} /><main className="main"><p>{msg}</p></main></div>
}

function NotFound({ nav, msg }) {
  return (
    <div className="app"><Header nav={nav} /><main className="main"><p>{msg || 'Presentation not found in this browser’s archive.'}</p>
      <button className="btn" style={{ marginTop: '1rem' }} onClick={() => nav({ mode: 'home' })}>Go to archive</button></main></div>
  )
}

export default App
