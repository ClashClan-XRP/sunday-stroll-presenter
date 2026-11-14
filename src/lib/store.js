// Local persistence for the presentation archive (browser localStorage).
// NOTE: localStorage is per-browser. A shared backend is needed for cross-device archives.
const KEY = 'swp_archive_v1'

export function loadArchive() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
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
  const list = loadArchive().filter(p => p.id !== pres.id)
  const updated = { ...pres, updatedAt: new Date().toISOString() }
  write([updated, ...list])
  return updated
}

export function getPresentation(id) {
  return loadArchive().find(p => p.id === id) || null
}

export function deletePresentation(id) {
  write(loadArchive().filter(p => p.id !== id))
}

export function newId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

// Portable devotionals payload (works on any device, no backend): base64url JSON in the URL hash.
export function encodePortable(pres) {
  const json = JSON.stringify({ t: pres.title, th: pres.theme, w: pres.weekOf, d: pres.devotionals, p: pres.publishedAt })
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodePortable(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
    const o = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return { title: o.t, theme: o.th, weekOf: o.w, devotionals: o.d, publishedAt: o.p, slides: [] }
  } catch { return null }
}
