import React, { useState, useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { parse } from 'pptxtojson'

function App() {
  const [slides, setSlides] = useState([])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [isPresenter, setIsPresenter] = useState(true)
  const [followUrl, setFollowUrl] = useState('')
  const [devotionals, setDevotionals] = useState([])
  const [view, setView] = useState('upload')
  const fileInputRef = useRef(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sid = params.get('session')
    const mode = params.get('mode')
    if (sid) {
      setSessionId(sid)
      setIsPresenter(mode !== 'follow')
      setView(mode === 'follow' ? 'follow' : 'present')
    } else {
      const newId = Math.random().toString(36).substring(2, 10).toUpperCase()
      setSessionId(newId)
      setFollowUrl(`${window.location.origin}${window.location.pathname}?session=${newId}&mode=follow`)
    }
  }, [])

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const arrayBuffer = await file.arrayBuffer()
    try {
      const result = await parse(arrayBuffer, {
        imageMode: 'base64',
        videoMode: 'none',
        audioMode: 'none'
      })

      const extractedSlides = result.slides.map((slide, idx) => {
        let text = ''
        let images = []
        if (slide.elements) {
          slide.elements.forEach(el => {
            if (el.type === 'text' && el.content) {
              text += el.content + '\n'
            }
            if (el.type === 'image' && el.src) {
              images.push(el.src)
            }
          })
        }
        return {
          id: idx,
          text: text.trim() || `Slide ${idx + 1}`,
          images,
          raw: slide
        }
      })

      setSlides(extractedSlides)
      setView('present')
      extractDevotionals(extractedSlides)
    } catch (err) {
      console.error('Parse error:', err)
      alert('Could not parse PPTX. Please try another file.')
    }
  }

  const extractDevotionals = (slidesData) => {
    const scriptures = []
    const regex = /([1-3]?\s?[A-Za-z]+)\s+(\d+):(\d+)(?:-(\d+))?/g
    slidesData.forEach(slide => {
      let match
      while ((match = regex.exec(slide.text)) !== null) {
        scriptures.push({
          reference: match[0],
          book: match[1],
          chapter: match[2],
          verse: match[3]
        })
      }
    })

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const devos = days.map((day, i) => {
      const scripture = scriptures[i % Math.max(scriptures.length, 1)] || { reference: 'Ephesians 5:1-2' }
      return {
        day,
        title: `Walk in the Light - Day ${i + 1}`,
        scripture: scripture.reference,
        content: `Today we reflect on ${scripture.reference}. As imitators of God, let us walk in love as Christ loved us. This is the foundation of our week at Camp Carroll. Consider how this truth shapes your actions, speech, and relationships today.`
      }
    })
    setDevotionals(devos)
  }

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) setCurrentSlide(c => c + 1)
  }

  const prevSlide = () => {
    if (currentSlide > 0) setCurrentSlide(c => c - 1)
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  if (view === 'devotionals') {
    return (
      <div className="app">
        <header className="header">
          <div className="logo">
            <div className="logo-icon">P</div>
            Sunday’s Walk Through The Week - Camp Carro
          </div>
          <button className="btn btn-secondary" onClick={() => setView('present')}>Back to Presentation</button>
        </header>
        <main className="main devotional-page">
          <h1 style={{marginBottom: '2rem', textAlign: 'center'}}>Daily Devotionals</h1>
          <p style={{textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '2rem'}}>
            Generated from the scriptures in this week's presentation
          </p>
          {devotionals.map((devo, idx) => (
            <div key={idx} className="devotional-card">
              <h2>{devo.day}</h2>
              <h3 style={{color: 'var(--accent-green)'}}>{devo.title}</h3>
              <div className="scripture">{devo.scripture}</div>
              <p>{devo.content}</p>
            </div>
          ))}
        </main>
      </div>
    )
  }

  if (view === 'follow') {
    return (
      <div className="app">
        <div className="slide-viewer" style={{margin: '1rem', aspectRatio: '16/9'}}>
          <div className="slide-content">
            {slides[currentSlide]?.text || 'Waiting for presentation to start...'}
          </div>
        </div>
        <div style={{textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)'}}>
          Following live • Slide {currentSlide + 1} of {slides.length || '?'}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-icon">P</div>
          Sunday’s Walk Through The Week - Camp Carro
        </div>
        {slides.length > 0 && (
          <div style={{display: 'flex', gap: '1rem'}}>
            <button className="btn btn-secondary" onClick={() => setView('devotionals')}>Devotionals</button>
            <button className="btn" onClick={toggleFullscreen}>Fullscreen</button>
          </div>
        )}
      </header>

      <main className="main">
        {slides.length === 0 ? (
          <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
            <h2 style={{marginBottom: '1rem'}}>Upload Your PPTX Presentation</h2>
            <p style={{color: 'var(--text-secondary)', marginBottom: '1.5rem'}}>
              Drop a PowerPoint file or click to browse. Styled after Proclaim for church presentations.
            </p>
            <button className="btn">Choose PPTX File</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx"
              style={{display: 'none'}}
              onChange={handleFileUpload}
            />
          </div>
        ) : (
          <>
            <div className="slide-viewer">
              <div className="slide-content">
                {slides[currentSlide]?.text || 'Empty slide'}
                {slides[currentSlide]?.images?.[0] && (
                  <img src={slides[currentSlide].images[0]} alt="" style={{maxWidth: '80%', marginTop: '1rem'}} />
                )}
              </div>
            </div>

            <div className="controls">
              <button className="btn btn-secondary" onClick={prevSlide} disabled={currentSlide === 0}>← Previous</button>
              <span style={{alignSelf: 'center'}}>Slide {currentSlide + 1} / {slides.length}</span>
              <button className="btn btn-secondary" onClick={nextSlide} disabled={currentSlide === slides.length - 1}>Next →</button>
              <button className="btn" onClick={toggleFullscreen}>Present Fullscreen</button>
            </div>

            <div className="qr-section">
              <h3 style={{marginBottom: '1rem'}}>Scan to Follow Along</h3>
              <QRCodeSVG value={followUrl} size={180} bgColor="#0f0c29" fgColor="#00e5a0" />
              <p style={{marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem'}}>
                {followUrl}
              </p>
              <p style={{marginTop: '0.5rem', fontSize: '0.85rem'}}>
                Session: {sessionId}
              </p>
            </div>
          </>
        )}
      </main>

      {isFullscreen && (
        <div className="fullscreen-overlay" onClick={() => setIsFullscreen(false)}>
          <div className="slide-content" style={{fontSize: '2.5rem', padding: '4rem'}}>
            {slides[currentSlide]?.text}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
