import React, { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { parse } from 'pptxtojson'
import { loadArchive, savePresentation, getPresentation, deletePresentation, newId, encodePortable, decodePortable, seedFromServer, fetchServerSession, exportSessionJson } from './lib/store'
import { generateDevotionals, detectTheme, DAYS, BOOKS, VERSIONS, formatRef, passageUrl, dayDate } from './lib/devotionals'
import { downloadPptx, downloadDevotionals } from './lib/exporters'

// ---------- helpers ----------
const htmlToText = html => {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html.replace(/<\/p>/gi, '</p>\n').replace(/<br\s*\/?>/gi, '\n'), 'text/html')
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

const readUrl = () => {
  const q = new URLSearchParams(window.location.search)
  return { session: q.get('session'), mode: q.get('mode') || (q.get('session') ? 'present' : 'home'), what: q.get('what'), day: q.get('day'), noprint: q.get('noprint') }
}

const base = () => `${window.location.origin}${window.location.pathname}`
// The audience QR opens the all-week bulletin. (Live slide sync is deferred - see README.)
export const bulletinUrlFor = id => `${base()}?session=${id}&mode=bulletin`
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

function SlideFace({ slide, big, qr, sermonTitle }) {
  if (!slide) return <div className="slide-content">Waiting for presentation to start...</div>
  const body = sermonTitle ? (slide.body || '').split('\n').filter(l => l.trim() !== sermonTitle.trim()).join('\n') : slide.body
  return (
    <div className={`slide-content ${qr ? 'has-qr' : ''}`} style={big ? { fontSize: '2.4rem', padding: '4rem' } : null}>
      {sermonTitle ? (
        <>
          <div className="slide-title" data-testid="slide-main-title">{sermonTitle}</div>
          <div className="slide-subtitle">{slide.title}</div>
        </>
      ) : <div className="slide-title">{slide.title}</div>}
      <div className="slide-body">{body}</div>
      {slide.images?.[0] && <img src={slide.images[0]} alt="" style={{ maxWidth: '60%', maxHeight: '40%', marginTop: '1rem' }} />}
      {qr && (
        <div className="title-qr" data-testid="title-qr">
          <QRCodeSVG value={qr} size={big ? 200 : 120} bgColor="#ffffff" fgColor="#0f0c29" includeMargin />
          <div>Scan for this week's bulletin</div>
        </div>
      )}
    </div>
  )
}

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
    const onPop = () => setRoute(readUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const [ready, setReady] = useState(false)
  useEffect(() => { seedFromServer().finally(() => setReady(true)) }, [])

  const { mode, session } = route
  if (!ready) return <div className="app"><main className="main"><p className="muted">Loading…</p></main></div>
  if (mode === 'bulletin' || mode === 'devotionals') return <Bulletin id={session} nav={nav} />
  if (mode === 'print') return <PrintView route={route} />
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
    setBusy(true)
    try {
      const result = await parse(await file.arrayBuffer(), { imageMode: 'base64', videoMode: 'none', audioMode: 'none' })
      const slides = result.slides.map((s, i) => {
        const texts = []; const images = []
        ;(s.elements || []).forEach(el => {
          if (el.content) { const t = htmlToText(el.content); if (t) texts.push(t) }
          if (el.type === 'image' && el.src) images.push(el.src)
        })
        return { id: `s${i}`, title: texts[0] || `Slide ${i + 1}`, body: texts.slice(1).join('\n'), notes: htmlToText(s.note || ''), images }
      })
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

  const remove = id => { if (confirm('Delete this presentation from the archive?')) { deletePresentation(id); setArchive(loadArchive()) } }

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
  if (!pres) return <NotFound nav={nav} />
  const locked = pres.status === 'published'

  const update = patch => { setPres(p => ({ ...p, ...patch })); setSaved(false) }
  const setSlide = (i, patch) => update({ slides: pres.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const move = (i, d) => { const s = [...pres.slides]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; update({ slides: s }) }
  const removeSlide = i => update({ slides: pres.slides.filter((_, j) => j !== i) })
  const addSlide = () => update({ slides: [...pres.slides, { id: `s${Date.now()}`, title: 'New slide', body: '', notes: '', images: [] }] })
  const setDevo = (i, patch) => update({ devotionals: pres.devotionals.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  const setVersionAll = v => update({ version: v, devotionals: pres.devotionals.map(d => ({ ...d, ref: { ...d.ref, version: v } })) })
  const save = () => { setPres(savePresentation(pres)); setSaved(true) }
  const publish = () => { setPres(savePresentation({ ...pres, sermonTitle: sermonTitleOf(pres), status: 'published', publishedAt: new Date().toISOString() })); setSaved(true) }
  const unpublish = () => { setPres(savePresentation({ ...pres, status: 'draft' })); setSaved(true) }

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

        {locked && (
          <div className="qr-section" data-testid="publish-qr">
            <h3>Published {new Date(pres.publishedAt).toLocaleString()}</h3>
            <div style={{ marginTop: '1rem' }}><QRCodeSVG value={bulletinUrlFor(pres.id)} size={170} bgColor="#ffffff" fgColor="#0f0c29" includeMargin /></div>
            <p className="small">Scan for this week's bulletin and daily devotionals</p>
            <p className="small muted">{bulletinUrlFor(pres.id)}</p>
            <div className="host-note" data-testid="host-note">
              <b>Phones need a hosted copy.</b> This QR opens the bulletin on this browser right away. For other devices, click
              {' '}<button className="btn btn-sm" data-testid="export-json" onClick={() => exportSessionJson(pres)}>Export for hosting</button>{' '}
              and add the downloaded <code>{pres.id}.json</code> to <code>public/sessions/</code> (and its id to <code>public/sessions/index.json</code>), then redeploy.
              Until then, use the bulletin's "Copy share link", which works on any device.
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

// ---------- Presenter: slide controls, title-slide QR, downloads ----------
function Presenter({ id, nav }) {
  const pres = getPresentation(id)
  const [idx, setIdx] = useState(0)
  const [full, setFull] = useState(false)
  const total = pres?.slides.length || 0
  const bulletinUrl = bulletinUrlFor(id)
  const published = pres?.status === 'published'

  const go = d => setIdx(i => Math.min(Math.max(i + d, 0), total - 1))
  useEffect(() => {
    const k = e => { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) go(1); if (['ArrowLeft', 'PageUp'].includes(e.key)) go(-1); if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [total])

  if (!pres) return <NotFound nav={nav} />
  const enterFull = () => { document.documentElement.requestFullscreen?.().catch(() => {}); setFull(true) }
  const exitFull = () => { if (document.fullscreenElement) document.exitFullscreen(); setFull(false) }
  const qr = published && idx === 0 ? bulletinUrl : null

  return (
    <div className="app">
      <Header nav={nav}>
        <button className="btn btn-secondary" onClick={() => nav({ session: id, mode: 'edit' })}>Review / Edit</button>
        <button className="btn btn-secondary" onClick={() => nav({ session: id, mode: 'bulletin' })}>Bulletin</button>
        <button className="btn btn-secondary" data-testid="dl-pptx" onClick={() => downloadPptx(pres, published ? bulletinUrl : null)}>Download PPTX</button>
        <button className="btn btn-secondary" data-testid="dl-pdf" onClick={() => window.open(`${base()}?session=${id}&mode=print&what=slides`, '_blank')}>Download PDF</button>
      </Header>
      <main className="main">
        <h2 style={{ marginBottom: '1rem' }}>{pres.title} {!published && <span className="badge draft">Draft - publish to enable QR</span>}</h2>
        <div className="slide-viewer" data-testid="presenter-slide"><SlideFace slide={pres.slides[idx]} qr={qr} sermonTitle={idx === 0 ? sermonTitleOf(pres) : null} /></div>
        <div className="controls">
          <button className="btn btn-secondary" data-testid="prev" onClick={() => go(-1)} disabled={idx === 0}>← Previous</button>
          <span style={{ alignSelf: 'center' }}>Slide {idx + 1} / {total}</span>
          <button className="btn btn-secondary" data-testid="next" onClick={() => go(1)} disabled={idx === total - 1}>Next →</button>
          <button className="btn" onClick={enterFull}>Present Fullscreen</button>
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
      {full && (
        <div className="fullscreen-overlay" onClick={() => go(1)}>
          <SlideFace slide={pres.slides[idx]} big qr={qr} sermonTitle={idx === 0 ? sermonTitleOf(pres) : null} />
          <button className="btn btn-secondary exit-full" onClick={e => { e.stopPropagation(); exitFull() }}>Exit</button>
        </div>
      )}
    </div>
  )
}

// ---------- Client bulletin: sermon outline + devotionals all week; print/download day or week ----------
function useSession(id) {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get('d')
  const local = (hash && decodePortable(hash)) || getPresentation(id)
  const [pres, setPres] = useState(local)
  const [loading, setLoading] = useState(!local)
  useEffect(() => { if (!local && id) fetchServerSession(id).then(p => { setPres(p); setLoading(false) }); else setLoading(false) }, [id])
  return { pres, loading, hash }
}

function Bulletin({ id, nav }) {
  const { pres, loading, hash } = useSession(id)
  if (loading) return <div className="app"><main className="main"><p className="muted">Loading bulletin…</p></main></div>
  if (!pres) return <ViewerMessage msg="This bulletin isn't available on this device yet. Ask the presenter for the share link." />
  if (!hash && pres.status !== 'published') return <ViewerMessage msg="This bulletin hasn't been published yet." />
  // Highlight today only when today falls inside this bulletin's week (Mon-Sun after the sermon Sunday).
  const todayIdx = (() => {
    if (!pres.weekOf) return (new Date().getDay() + 6) % 7
    const start = new Date(`${pres.weekOf}T00:00:00`); const diff = Math.floor((Date.now() - start) / 86400000) - 1
    return diff >= 0 && diff < 7 ? diff : -1
  })()
  const today = DAYS[todayIdx]
  const portable = `${bulletinUrlFor(id)}#d=${encodePortable(pres)}`
  const printUrl = (what, day) => `${base()}?session=${id}&mode=print&what=${what}${day !== undefined ? `&day=${day}` : ''}${hash ? `#d=${hash}` : ''}`
  return (
    <div className="app">
      <Header nav={nav} viewer>
        <button className="btn btn-secondary" data-testid="print-week" onClick={() => window.open(printUrl('week'), '_blank')}>Print / PDF week</button>
        <button className="btn btn-secondary" data-testid="dl-week" onClick={() => downloadDevotionals(pres, pres.devotionals, 'html', 'week')}>Download week</button>
        <button className="btn btn-secondary" data-testid="dl-week-txt" onClick={() => downloadDevotionals(pres, pres.devotionals, 'txt', 'week')}>Save week (.txt)</button>
        <button className="btn btn-secondary" data-testid="copy-portable" onClick={() => navigator.clipboard?.writeText(portable)}>Copy share link</button>
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
  const { pres, loading } = useSession(route.session)
  useEffect(() => { if (pres && !route.noprint) setTimeout(() => window.print(), 400) }, [pres])
  if (loading) return <p style={{ padding: '2rem' }}>Loading…</p>
  if (!pres) return <p style={{ padding: '2rem' }}>Nothing to print.</p>
  if (route.what === 'slides') {
    return (
      <div className="print-root">
        {pres.slides.map((s, i) => (
          <div className="print-slide" key={s.id}>
            <div className="ps-title">{s.title}</div>
            <div className="ps-body">{s.body}</div>
            {i === 0 && pres.status === 'published' && <div className="ps-qr"><QRCodeSVG value={bulletinUrlFor(pres.id)} size={110} includeMargin /></div>}
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
