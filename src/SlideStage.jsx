import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

// Slides render on a fixed "stage" (the PPTX page size in points, default 960x540 = 16:9),
// scaled to fit the container with letterboxing, so nothing can spill past the edges.
export const DEFAULT_LAYOUT = { w: 960, h: 540 }
const PT = 4 / 3 // CSS px per pt

function useFitScale(ref, w, h) {
  const [scale, setScale] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => { const r = el.getBoundingClientRect(); setScale(Math.min(r.width / (w * PT), r.height / (h * PT)) || 0) }
    update()
    const ro = new ResizeObserver(update); ro.observe(el)
    return () => ro.disconnect()
  }, [w, h])
  return scale
}

// Shrinks its content (CSS zoom) until it fits its box.
function AutoFit({ children, style, className, deps }) {
  const ref = useRef(null)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => { setZoom(1) }, deps)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && zoom > 0.35) setZoom(z => Math.round((z - 0.05) * 100) / 100)
  })
  return <div ref={ref} className={className} style={{ ...style, overflow: 'hidden' }}><div style={{ zoom }}>{children}</div></div>
}

const bgStyle = bg => {
  if (!bg) return { background: '#000' }
  if (bg.type === 'image' && bg.src) return { background: `#000 url(${bg.src}) center / cover no-repeat` }
  if (bg.type === 'gradient' && bg.colors?.length) return { background: `linear-gradient(${(bg.rot || 0) + 90}deg, ${bg.colors.map(c => `${c.color} ${c.pos}`).join(', ')})` }
  if (bg.type === 'color' && bg.color) return { background: bg.color }
  return { background: '#000' }
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// QR badge: code is 15% of slide height (badge ~20% with quiet zone and caption), in a corner that doesn't cover any text box.
function QrBadge({ url, layout, elements }) {
  const size = layout.h * 0.15, cap = layout.h * 0.024, m = layout.h * 0.022
  const pad = size * 0.07 // white quiet zone around the code (~2 modules) so cameras lock on
  const bw = size + pad * 2, bh = size + pad * 2 + cap * 1.2
  const corners = [
    { x: layout.w - bw - m, y: layout.h - bh - m }, { x: m, y: layout.h - bh - m },
    { x: layout.w - bw - m, y: m }, { x: m, y: m }
  ]
  const texts = (elements || []).filter(e => e.kind !== 'image' && e.html)
  const pos = corners.find(c => !texts.some(t => overlaps({ ...c, w: bw, h: bh }, t))) || corners[0]
  return (
    <div className="qr-badge" data-testid="title-qr" style={{ left: `${pos.x}pt`, top: `${pos.y}pt`, width: `${bw}pt`, height: `${bh}pt`, fontSize: `${cap * 0.55}pt`, padding: `${pad}pt ${pad}pt 0` }}>
      <QRCodeSVG value={url} size={256} level="L" style={{ width: `${size}pt`, height: `${size}pt`, display: 'block', margin: '0 auto' }} bgColor="#ffffff" fgColor="#000000" />
      <div>Scan for bulletin</div>
    </div>
  )
}

export function SlideStage({ slide, qr, sermonTitle, className = '', style, testid, fill }) {
  const boxRef = useRef(null)
  const layout = slide?.layout || DEFAULT_LAYOUT
  const scale = useFitScale(boxRef, layout.w, layout.h)
  const original = slide && slide.elements?.length && !slide.edited
  const stageStyle = {
    width: `${layout.w}pt`, height: `${layout.h}pt`, transform: `translate(-50%, -50%) scale(${scale})`,
    ...(original ? bgStyle(slide.bg) : { background: '#000' })
  }
  return (
    <div ref={boxRef} className={`stage-box ${className}`} style={{ ...(fill ? {} : { aspectRatio: `${layout.w} / ${layout.h}` }), ...style }} data-testid={testid}>
      <div className="stage" style={stageStyle}>
        {!slide ? <div className="stage-text"><div className="slide-body">Waiting for presentation to start...</div></div>
          : original ? slide.elements.map((e, i) => (
            e.kind === 'image' && !e.src
              ? <div key={i} className="el el-img-placeholder" style={{ left: `${e.x}pt`, top: `${e.y}pt`, width: `${e.w}pt`, height: `${e.h}pt` }} />
              : e.kind === 'image'
              ? <img key={i} className="el" src={e.src} alt="" style={{ left: `${e.x}pt`, top: `${e.y}pt`, width: `${e.w}pt`, height: `${e.h}pt`, transform: e.rot ? `rotate(${e.rot}deg)` : undefined }} />
              : <AutoFit key={i} className={`el el-text v-${e.v || 'top'}`} deps={[slide.id]} style={{ left: `${e.x}pt`, top: `${e.y}pt`, width: `${e.w}pt`, height: `${e.h}pt`, background: e.fill || 'transparent', borderRadius: e.round ? '10pt' : 0, transform: e.rot ? `rotate(${e.rot}deg)` : undefined }}>
                  <div dangerouslySetInnerHTML={{ __html: e.html || '' }} />
                </AutoFit>
          ))
          : (
            <AutoFit className="stage-text" deps={[slide.id, slide.title, slide.body, sermonTitle, !!qr]} style={qr ? { bottom: `${layout.h * 0.24}pt` } : null}>
              {sermonTitle ? <>
                <div className="slide-title" data-testid="slide-main-title">{sermonTitle}</div>
                <div className="slide-subtitle">{slide.title}</div>
              </> : <div className="slide-title">{slide.title}</div>}
              <div className="slide-body">{sermonTitle ? (slide.body || '').split('\n').filter(l => l.trim() !== sermonTitle.trim()).join('\n') : slide.body}</div>
              {slide.images?.[0] && <img src={slide.images[0]} alt="" style={{ maxWidth: '50%', maxHeight: '160pt', marginTop: '10pt' }} />}
            </AutoFit>
          )}
        {qr && <QrBadge url={qr} layout={layout} elements={original ? slide.elements : null} />}
      </div>
    </div>
  )
}
