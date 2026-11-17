import test from 'node:test'
import assert from 'node:assert/strict'
import { write, loadArchive } from './store.js'

const KEY = 'ssp_archive_v1'

function install(setItem) {
  const mem = new Map()
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { setItem(k, v); mem.set(k, v) },
    removeItem: k => mem.delete(k),
    clear: () => mem.clear()
  }
  return mem
}

const quota = () => {
  const err = new Error('The quota has been exceeded.')
  err.name = 'QuotaExceededError'
  return err
}

test('write falls back by stripping element and background images when storage is full', () => {
  const seen = []
  let first = true
  install((k, v) => {
    seen.push(v)
    if (first) {
      first = false
      throw quota()
    }
  })
  const overlay = `data:image/png;base64,${'A'.repeat(400)}`
  const bg = `data:image/jpeg;base64,${'B'.repeat(400)}`
  const saved = write([{
    id: 'P1',
    slides: [{
      title: 'Keep',
      images: [overlay],
      bg: { type: 'image', src: bg },
      elements: [
        { kind: 'image', src: overlay },
        { kind: 'text', html: 'keep me' }
      ]
    }]
  }])
  assert.equal(seen.length, 2)
  assert.equal(saved[0].slides[0].elements[0].src, '')
  assert.equal(saved[0].slides[0].bg.src, '')
  assert.deepEqual(saved[0].slides[0].images, [])
  assert.equal(saved[0].slides[0].elements[1].html, 'keep me')
  const raw = localStorage.getItem(KEY)
  assert.equal(raw.includes('data:image'), false)
  assert.equal(loadArchive()[0].slides[0].title, 'Keep')
})

test('write rethrows when the slim copy still exceeds the quota', () => {
  let calls = 0
  install(() => {
    calls += 1
    throw quota()
  })
  assert.throws(
    () => write([{ slides: [{ elements: [{ kind: 'image', src: 'data:image/png;base64,AAAA' }] }] }]),
    err => err.name === 'QuotaExceededError'
  )
  assert.equal(calls, 2)
})

test('write does not strip pictures for a non-quota failure', () => {
  let calls = 0
  install(() => {
    calls += 1
    throw new Error('denied')
  })
  assert.throws(() => write([{ slides: [{ elements: [{ kind: 'image', src: 'data:image/png;base64,AAAA' }] }] }]), /denied/)
  assert.equal(calls, 1)
})

test('write stores one copy of a repeated data URL and loadArchive restores it', () => {
  install(() => {})
  const overlay = `data:image/png;base64,${'C'.repeat(800)}`
  const slides = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`,
    elements: [{ kind: 'image', src: overlay }],
    bg: { type: 'image', src: overlay }
  }))
  write([{ id: 'P', slides }])
  const stored = JSON.parse(localStorage.getItem(KEY))
  assert.equal(stored.pool.length, 1)
  assert.equal(stored.pool[0], overlay)
  assert.equal(stored.items[0].slides.every(s => s.elements[0].src === 'sspimg:0' && s.bg.src === 'sspimg:0'), true)
  assert.ok(localStorage.getItem(KEY).length < overlay.length * 3)
  const loaded = loadArchive()
  assert.equal(loaded[0].slides[0].elements[0].src, overlay)
  assert.equal(loaded[0].slides[5].bg.src, overlay)
})
