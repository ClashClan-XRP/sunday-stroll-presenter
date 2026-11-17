// Converts pptxtojson output into positioned slide elements (text boxes, shapes, pictures, backgrounds).
// Pictures are re-encoded (max 1600px) so whole decks fit in browser storage.
const UNSAFE = /^(script|style|iframe|object|embed|link|meta)$/i
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html')
  doc.body.querySelectorAll('*').forEach(n => {
    if (UNSAFE.test(n.tagName)) { n.remove(); return }
    ;[...n.attributes].forEach(a => { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name) })
  })
  return doc.body.firstChild.innerHTML
}

export async function shrinkImage(src, max = 1600) {
  if (!src?.startsWith('data:image') || src.length < 150000) return src
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
    const s = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const png = src.startsWith('data:image/png')
    const out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.8)
    if (png && out.length > 400000) return c.toDataURL('image/webp', 0.85)
    return out.length < src.length ? out : src
  } catch { return src }
}

const fillColor = f => (f && f.type === 'color' && f.value ? f.value : null)

async function flatten(elements, dx = 0, dy = 0, out = []) {
  const sorted = [...(elements || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const e of sorted) {
    const x = (e.left || 0) + dx, y = (e.top || 0) + dy
    if (e.type === 'group' && e.elements) { await flatten(e.elements, x, y, out); continue }
    if (e.type === 'image' && e.src) out.push({ kind: 'image', x, y, w: e.width, h: e.height, rot: e.rotate || 0, src: await shrinkImage(e.src) })
    else if (e.type === 'text' || e.type === 'shape') {
      const html = e.content ? sanitizeHtml(e.content) : ''
      const fill = fillColor(e.fill)
      if (!html && !fill) continue
      out.push({ kind: e.type, x, y, w: e.width, h: e.height, rot: e.rotate || 0, html, fill, round: /roundRect/i.test(e.shapType || ''), v: e.vAlign === 'mid' ? 'mid' : e.vAlign === 'down' ? 'down' : 'top' })
    }
    // tables, charts, SmartArt diagrams, video/audio: not rendered (text is still extracted for the editor)
  }
  return out
}

async function background(fill) {
  if (!fill) return null
  if (fill.type === 'color' && fill.value) return { type: 'color', color: fill.value }
  if (fill.type === 'image' && fill.value?.picBase64) return { type: 'image', src: await shrinkImage(fill.value.picBase64) }
  if (fill.type === 'gradient' && fill.value?.colors) return { type: 'gradient', rot: fill.value.rot || 0, colors: fill.value.colors.map(c => ({ color: c.color, pos: c.pos })) }
  return null
}

export async function importSlides(result, htmlToText) {
  const layout = result.size?.width ? { w: result.size.width, h: result.size.height } : { w: 960, h: 540 }
  const slides = []
  for (let i = 0; i < result.slides.length; i++) {
    const s = result.slides[i]
    const all = [...(s.layoutElements || []), ...(s.elements || [])]
    const texts = []
    const walk = els => els.forEach(el => { if (el.type === 'group') walk(el.elements || []); else if (el.content) { const t = htmlToText(el.content); if (t) texts.push(t) } })
    walk(s.elements || [])
    const elements = await flatten(all)
    slides.push({
      id: `s${i}`, title: texts[0] || `Slide ${i + 1}`, body: texts.slice(1).join('\n'), notes: htmlToText(s.note || ''),
      images: [], layout, bg: await background(s.fill), elements, edited: false
    })
  }
  return slides
}
