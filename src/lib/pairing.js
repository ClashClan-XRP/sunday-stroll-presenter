// Pure pairing decisions for the phone remote.
// The laptop can already be open and broadcasting slide state before this phone's
// hello is applied. That early state has no controller. It must not clear a
// finished handshake, and a later state that names this phone must unlock the
// controls even when the separate "paired" packet was missed.

export const BUSY_DETAIL = 'Another phone is already controlling this presentation. On the laptop, click "Disconnect / New code" and scan the new code.'
export const ENDED_DETAIL = 'The presenter ended the remote session or made a new code. Scan the new code on the laptop.'
export const WAITING_DETAIL = 'Still pairing. If the laptop is already open, tap Retry.'

const keep = phone => ({
  state: phone.state,
  detail: phone.detail || '',
  hello: false,
  derive: null,
  dropPk: false,
  showState: false,
  stop: false
})

export function applyPhoneMessage(phone, msg) {
  if (!msg || msg.t === 'bye') {
    return { state: 'ended', detail: ENDED_DETAIL, hello: false, derive: null, dropPk: true, showState: false, stop: true }
  }
  if (msg.t === 'busy' && msg.to === phone.sid && !phone.pk) {
    return { state: 'busy', detail: BUSY_DETAIL, hello: false, derive: null, dropPk: false, showState: false, stop: false }
  }
  if (msg.t === 'paired' && msg.to === phone.sid && typeof msg.hpub === 'string') {
    if (phone.pk && phone.pairedHs === msg.sid) return { ...keep(phone), state: 'connected', detail: '' }
    return { state: 'connected', detail: '', hello: false, derive: { hpub: msg.hpub, hs: msg.sid }, dropPk: false, showState: false, stop: false }
  }
  if (msg.t !== 'state') return keep(phone)
  if (phone.state === 'ended' || phone.state === 'lost') return keep(phone)
  if (msg.ctl && msg.ctl !== phone.sid) {
    return { state: 'busy', detail: BUSY_DETAIL, hello: false, derive: null, dropPk: false, showState: false, stop: false }
  }
  if (phone.state === 'busy') return { ...keep(phone), detail: BUSY_DETAIL }
  if (msg.ctl === phone.sid) {
    const same = phone.pk && phone.pairedHs === msg.hs
    if (!same && typeof msg.hpub !== 'string') {
      return { state: 'waiting', detail: '', hello: true, derive: null, dropPk: false, showState: true, stop: false }
    }
    return {
      state: 'connected',
      detail: '',
      hello: false,
      derive: !same ? { hpub: msg.hpub, hs: msg.hs } : null,
      dropPk: false,
      showState: true,
      stop: false
    }
  }
  // No controller on this state. Same laptop session and an existing key means the
  // broadcast left the laptop before it recorded the hello. Stay unlocked.
  if (phone.pk && phone.pairedHs && msg.hs === phone.pairedHs) {
    return { state: 'connected', detail: '', hello: false, derive: null, dropPk: false, showState: true, stop: false }
  }
  const restarted = !!(phone.pairedHs && msg.hs && msg.hs !== phone.pairedHs)
  return { state: 'waiting', detail: '', hello: true, derive: null, dropPk: restarted, showState: true, stop: false }
}
