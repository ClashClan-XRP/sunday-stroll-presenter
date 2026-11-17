import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadErrorMessage } from './uploadError.js'

test('quota errors tell the presenter that storage is full', () => {
  const byName = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
  const byMessage = new Error('QuotaExceededError')
  for (const err of [byName, byMessage]) {
    const text = uploadErrorMessage(err)
    assert.match(text, /Could not save the presentation: this browser's storage is full/)
    assert.match(text, /Delete an old presentation from the archive and try again/)
    assert.ok(text.endsWith(err.message))
    assert.equal(text.includes('Could not parse PPTX'), false)
  }
})

test('other upload errors keep the real parse message', () => {
  const text = uploadErrorMessage(new Error('invalid zip'))
  assert.equal(text, 'Could not parse PPTX: invalid zip')
})
