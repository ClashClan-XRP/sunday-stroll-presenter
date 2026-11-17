import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPhoneMessage, WAITING_DETAIL } from './pairing.js'

const phone = (over = {}) => ({ state: 'waiting', sid: 'phone', pk: false, pairedHs: null, detail: '', ...over })

test('a missed paired packet still unlocks when state names this phone', () => {
  const d = applyPhoneMessage(phone(), { t: 'state', ctl: 'phone', hs: 'laptop', hpub: 'HOSTPUB', idx: 1 })
  assert.equal(d.state, 'connected')
  assert.deepEqual(d.derive, { hpub: 'HOSTPUB', hs: 'laptop' })
  assert.equal(d.dropPk, false)
  assert.equal(d.showState, true)
  assert.equal(d.hello, false)
})

test('a state broadcast from before the hello does not clear a finished handshake', () => {
  const d = applyPhoneMessage(phone({ state: 'connected', pk: true, pairedHs: 'laptop' }), { t: 'state', ctl: null, hs: 'laptop', idx: 2 })
  assert.equal(d.state, 'connected')
  assert.equal(d.dropPk, false)
  assert.equal(d.hello, false)
  assert.equal(d.showState, true)
})

test('presenter reload (new session id) drops the key and pairs again', () => {
  const d = applyPhoneMessage(phone({ state: 'connected', pk: true, pairedHs: 'old' }), { t: 'state', ctl: null, hs: 'new', idx: 0 })
  assert.equal(d.state, 'waiting')
  assert.equal(d.dropPk, true)
  assert.equal(d.hello, true)
})

test('paired message unlocks and is ignored once that laptop session is current', () => {
  const first = applyPhoneMessage(phone(), { t: 'paired', to: 'phone', hpub: 'HOSTPUB', sid: 'laptop' })
  assert.equal(first.state, 'connected')
  assert.deepEqual(first.derive, { hpub: 'HOSTPUB', hs: 'laptop' })
  const again = applyPhoneMessage(phone({ state: 'connected', pk: true, pairedHs: 'laptop' }), { t: 'paired', to: 'phone', hpub: 'HOSTPUB', sid: 'laptop' })
  assert.equal(again.derive, null)
  assert.equal(again.state, 'connected')
})

test('another controller locks this phone out', () => {
  const d = applyPhoneMessage(phone({ state: 'waiting' }), { t: 'state', ctl: 'other', hs: 'laptop' })
  assert.equal(d.state, 'busy')
  assert.equal(d.showState, false)
})

test('bye ends the session', () => {
  const d = applyPhoneMessage(phone({ state: 'connected', pk: true, pairedHs: 'laptop' }), { t: 'bye' })
  assert.equal(d.state, 'ended')
  assert.equal(d.stop, true)
  assert.equal(d.dropPk, true)
})

test('waiting copy tells the presenter to retry when the laptop is already open', () => {
  assert.match(WAITING_DETAIL, /Still pairing/)
  assert.match(WAITING_DETAIL, /Retry/)
})
