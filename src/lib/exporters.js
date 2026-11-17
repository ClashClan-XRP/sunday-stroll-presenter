import PptxGenJS from 'pptxgenjs'
import { devotionalText, scriptureLabel } from './devotionals'

export async function downloadPptx(pres, followUrl) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = pres.title
  pres.slides.forEach((s, i) => {
    const slide = pptx.addSlide()
    slide.background = { color: '0F0C29' }
    slide.addText(s.title || '', { x: 0.6, y: 0.5, w: 12.1, h: 1.2, fontSize: i === 0 ? 44 : 34, bold: true, color: '00E5A0', align: i === 0 ? 'center' : 'left' })
    slide.addText(s.body || '', { x: 0.6, y: 1.9, w: 12.1, h: 4.8, fontSize: 24, color: 'FFFFFF', valign: 'top', align: i === 0 ? 'center' : 'left' })
    if (i === 0 && followUrl) slide.addText(`Follow along: ${followUrl}`, { x: 0.6, y: 6.7, w: 12.1, h: 0.5, fontSize: 14, color: '00D4FF', align: 'center' })
    if (s.notes) slide.addNotes(s.notes)
  })
  await pptx.writeFile({ fileName: `${safe(pres.title)}.pptx` })
}

const safe = t => (t || 'presentation').replace(/[^a-z0-9_-]+/gi, '_')
const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function devoHtml(pres, devos) {
  const cards = devos.map(d => `<section><h2>${esc(d.day)}: ${esc(d.title)}</h2><p class="ref">${esc(scriptureLabel(d))}</p>${d.also?.length ? `<p>Also named on the slide: ${esc(d.also.join('; '))}</p>` : ''}<p>${esc(d.reflection)}</p><p><b>Prayer:</b> ${esc(d.prayer)}</p><p><b>Today:</b> ${esc(d.action)}</p></section>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pres.title)} - Devotionals</title><style>body{font-family:Georgia,serif;max-width:720px;margin:2rem auto;color:#222;line-height:1.5}h1{color:#302b63}section{page-break-inside:avoid;border-top:2px solid #00a37a;padding:.5rem 0 1rem}.ref{font-style:italic;color:#00796b}</style></head><body><h1>${esc(pres.title)}</h1><p><i>${esc(pres.theme)}</i></p>${cards}</body></html>`
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDevotionals(pres, devos, format, label) {
  const name = `${safe(pres.title)}_${safe(label)}`
  if (format === 'txt') download(`${name}.txt`, `${pres.title}\n${pres.theme}\n\n` + devos.map(devotionalText).join('\n'), 'text/plain')
  else download(`${name}.html`, devoHtml(pres, devos), 'text/html')
}
