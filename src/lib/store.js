// Local persistence for the presentation archive (browser localStorage).
// NOTE: localStorage is per-browser. A shared backend is needed for cross-device archives.
const KEY = 'ssp_archive_v1'
const OLD_KEY = 'swp_archive_v1' // storage key used before the project rename

export function loadArchive() {
  try { return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY) || '[]') } catch { return [] }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch (e) {
    // Quota exceeded (usually embedded images) - retry without images.
    const slim = list.map(p => ({ ...p, slides: p.slides.map(s => ({ ...s, images: [] })) }))
    localStorage.setItem(KEY, JSON.stringify(slim))
  }
}

export function savePresentation(pres) {
  const h = hiddenIds(); if (h.delete(pres.id)) setHidden(h)
  const list = loadArchive().filter(p => p.id !== pres.id)
  const updated = { ...pres, updatedAt: new Date().toISOString() }
  write([updated, ...list])
  return updated
}

export function getPresentation(id) {
  return loadArchive().find(p => p.id === id) || null
}

// Sessions the host deleted on this device. The static server copy must not re-add them to the archive.
const HIDDEN_KEY = 'ssp_hidden_v1'
export function hiddenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() }
}
function setHidden(set) { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])) }

export function deletePresentation(id) {
  write(loadArchive().filter(p => p.id !== id))
  const h = hiddenIds(); h.add(id); setHidden(h)
}

export function newId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

// Portable devotionals payload (works on any device, no backend): base64url JSON in the URL hash.
export function encodePortable(pres) {
  const json = JSON.stringify({ t: pres.title, st: pres.sermonTitle, th: pres.theme, w: pres.weekOf, d: pres.devotionals, p: pres.publishedAt })
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodePortable(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
    const o = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return { title: o.t, sermonTitle: o.st, theme: o.th, weekOf: o.w, devotionals: o.d, publishedAt: o.p, slides: [] }
  } catch { return null }
}

// Static "server copy": published sessions exported to public/sessions/*.json.
// On a new device the archive is empty, so import any published session it doesn't have yet.
// Local copies are never overwritten.
export async function seedFromServer() {
  try {
    const res = await fetch('sessions/index.json', { cache: 'no-store' })
    if (!res.ok) return
    const ids = await res.json()
    const have = new Set(loadArchive().map(p => p.id))
    const hidden = hiddenIds()
    for (const id of ids) {
      if (have.has(id) || hidden.has(id)) continue
      const r = await fetch(`sessions/${id}.json`, { cache: 'no-store' })
      if (r.ok) {
        const pres = await r.json()
        // Re-check after the await so concurrent seeds (e.g. React StrictMode) can't add duplicates.
        if (!loadArchive().some(p => p.id === pres.id) && !hiddenIds().has(pres.id)) write([...loadArchive(), pres])
      }
    }
  } catch (e) { console.warn('seedFromServer failed', e) }
}

// Read one published session from the static server copy (used by bulletin/print links even if hidden locally).
let indexP = null
const hostedIds = () => (indexP ||= fetch('sessions/index.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).catch(() => []))
export async function fetchServerSession(id) {
  try {
    if (!(await hostedIds()).includes(id)) return null // not hosted: skip the request (avoids a 404)
    const r = await fetch(`sessions/${id}.json`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

// "Export for hosting": download the session JSON to place in public/sessions/ (and list its id in index.json).
export function exportSessionJson(pres) {
  const clean = { ...pres, slides: pres.slides.map(s => ({ ...s, images: [] })) }
  const url = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 1)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `${pres.id}.json`
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
