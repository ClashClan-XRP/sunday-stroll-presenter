// Phone-as-remote relay. No account needed. Three free public relays run side by side:
//  1) PeerJS (direct WebRTC data channel; signaling via the free PeerJS cloud server)
//  2) Nostr public relays (WSS on port 443, ephemeral events that relays don't store)
//  3) MQTT over WSS on public test brokers (ports 8084/8884/8081, no retained messages)
//
// Security model (the pairing code is the shared secret):
//  - The code is 18 random characters (~89 bits) and is never sent anywhere. Only values derived from it are:
//    PBKDF2-SHA256 (310,000 iterations) -> HKDF with separate labels -> (a) AES-GCM key, (b) channel id.
//    The channel id names the PeerJS peer, the Nostr tag and the MQTT topics.
//  - Every message on every transport is AES-GCM encrypted + authenticated with that key.
//  - Replay protection: each message carries a sender id, a strictly increasing counter and a timestamp;
//    duplicates, older counters and anything outside a 5-minute window are dropped. Commands must also
//    name the laptop's current session id, so commands captured from an earlier session are refused.
//  - Only one phone controls at a time; the laptop can disconnect it and rotate the code.
// Public relays are best-effort; production should use a hosted relay (Firebase/Supabase or self-hosted).
import Peer from 'peerjs'
import mqtt from 'mqtt'
import { SimplePool } from 'nostr-tools/pool'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import { applyPhoneMessage, WAITING_DETAIL } from './pairing.js'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 symbols, no 0/O/1/I/L
export const CODE_LEN = 18 // 18 * log2(31) = ~89 bits
export function newPairCode(len = CODE_LEN) {
  const out = []
  while (out.length < len) { // rejection sampling: no modulo bias
    const a = new Uint8Array(32); crypto.getRandomValues(a)
    for (const n of a) if (n < 248 && out.length < len) out.push(ALPHABET[n % 31])
  }
  return out.join('')
}
export const normalizeCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const formatCode = c => (c || '').match(/.{1,6}/g)?.join('-') || ''
export const validCode = c => c.length === CODE_LEN && [...c].every(ch => ALPHABET.includes(ch))

// Small in-page log for troubleshooting (window.__remoteLog)
const log = (...a) => { try { (window.__remoteLog ||= []).push(`${new Date().toISOString().slice(11, 23)} ${a.join(' ')}`) } catch {} }

// ---- key + channel derivation ----
const enc = new TextEncoder(), dec = new TextDecoder()
export const KDF_ITERATIONS = 310000
const secrets = new Map()
export function deriveSecrets(code) {
  if (!secrets.has(code)) {
    secrets.set(code, (async () => {
      const pw = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits'])
      const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('sunday-stroll/remote/v2/pbkdf2'), iterations: KDF_ITERATIONS, hash: 'SHA-256' }, pw, 256)
      const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits'])
      const hkdf = info => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sunday-stroll/remote/v2/hkdf'), info: enc.encode(info) })
      const key = await crypto.subtle.deriveKey(hkdf('aes-gcm message key'), hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      const chanBits = new Uint8Array(await crypto.subtle.deriveBits(hkdf('public channel id'), hk, 128))
      const chan = [...chanBits].map(x => x.toString(16).padStart(2, '0')).join('')
      return { key, chan }
    })())
  }
  return secrets.get(code)
}
const b64 = u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))))
  return `${b64(iv)}.${b64(ct)}`
}
async function unseal(key, text) {
  if (typeof text !== 'string') throw new Error('bad')
  const [iv, ct] = text.split('.')
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct))))
}
// PeerJS on iOS sometimes delivers a Blob or bytes instead of the string we sent.
async function payloadText(payload) {
  if (typeof payload === 'string') return payload
  if (payload instanceof ArrayBuffer) return dec.decode(new Uint8Array(payload))
  if (ArrayBuffer.isView(payload)) return dec.decode(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
  if (typeof Blob !== 'undefined' && payload instanceof Blob) return payload.text()
  return ''
}

// ---- replay protection ----
const WINDOW_MS = 5 * 60 * 1000
function makeSender(sid) {
  let last = 0
  return obj => { last = Math.max(Date.now(), last + 1); return { ...obj, sid, n: last, ts: Date.now() } }
}
function makeGuard() {
  const last = new Map()
  return m => {
    if (!m || typeof m.sid !== 'string' || typeof m.n !== 'number' || typeof m.ts !== 'number') return false
    if (Math.abs(Date.now() - m.ts) > WINDOW_MS) return false
    if (Math.abs(m.n - m.ts) > 5000) return false // the counter is a millisecond clock: it can't run ahead of the timestamp
    if (m.n <= (last.get(m.sid) || 0)) return false // duplicate (same message via another relay) or replay
    last.set(m.sid, m.n)
    return true
  }
}
// ---- per-phone command key (F1): ECDH P-256 at pairing, inside the code-encrypted channel ----
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
async function phoneKeypair(chan) {
  const k = `ssp_rkey_${chan}`
  try {
    const saved = JSON.parse(sessionStorage.getItem(k) || 'null')
    if (saved) return { priv: await crypto.subtle.importKey('jwk', saved.priv, ECDH, true, ['deriveBits']), pub: saved.pub }
  } catch {}
  const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const pub = b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  sessionStorage.setItem(k, JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub }))
  return { priv: kp.privateKey, pub }
}
async function commandKey(priv, otherPubB64, chan, hs, sid) {
  const other = await crypto.subtle.importKey('raw', unb64(otherPubB64), ECDH, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: other }, priv, 256)
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(chan), info: enc.encode(`sunday-stroll per-phone command key|${hs}|${sid}`) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
const randomId = () => b64(crypto.getRandomValues(new Uint8Array(9)))

// ---- transports: each delivers opaque sealed strings ----
export const NOSTR_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social', 'wss://offchain.pub', 'wss://nostr.oxtr.dev']
const KIND = 21777 // ephemeral range: relays forward but don't store
function nostrTransport(chan, onPayload, onStatus) {
  const pool = new SimplePool({ enablePing: true, enableReconnect: true })
  const sk = generateSecretKey()
  const seen = new Set()
  let up = false, closed = false
  const sub = pool.subscribeMany(NOSTR_RELAYS, { kinds: [KIND], '#t': [chan], since: Math.floor(Date.now() / 1000) }, {
    onevent: ev => { if (seen.has(ev.id)) return; seen.add(ev.id); onPayload(ev.content) },
    oneose: () => { up = true; onStatus('ready') }
  })
  setTimeout(() => { if (!up && !closed) onStatus('unavailable') }, 10000)
  return {
    get ready() { return up },
    async send(payload) {
      if (closed) return
      const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', chan]], content: payload }, sk)
      const r = await Promise.allSettled(pool.publish(NOSTR_RELAYS, ev))
      if (r.some(x => x.status === 'fulfilled')) { if (!up) { up = true; onStatus('ready') } } else onStatus('error')
    },
    close() { closed = true; try { sub.close() } catch {} ; try { pool.close(NOSTR_RELAYS) } catch {} }
  }
}

export const MQTT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt']
// in = topic we listen on, out = topic we publish to. Never retained.
function mqttTransport(chan, inKind, outKind, onPayload, onStatus) {
  const t = k => `sunday-stroll/v2/${chan}/${k}`
  let client = null, i = 0, done = false, closed = false, timer = null
  const tryNext = () => {
    if (closed) return
    if (i >= MQTT_BROKERS.length) { onStatus('unavailable'); i = 0; timer = setTimeout(tryNext, 30000); return }
    const url = MQTT_BROKERS[i++]
    const c = mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 0, clean: true })
    client = c
    let failed = false
    const fail = () => { if (done || failed) return; failed = true; try { c.end(true) } catch {} ; tryNext() }
    c.once('connect', () => {
      done = true; c.options.reconnectPeriod = 3000
      c.subscribe(t(inKind)); onStatus('ready')
      c.on('message', (_t, buf) => onPayload(buf.toString()))
      c.on('close', () => onStatus('reconnecting'))
      c.on('connect', () => { c.subscribe(t(inKind)); onStatus('ready') })
    })
    c.once('error', fail)
    setTimeout(() => { if (!done) fail() }, 7000)
  }
  tryNext()
  return {
    get ready() { return !!client?.connected },
    send(payload) { if (client?.connected) client.publish(t(outKind), payload, { qos: 0, retain: false }) },
    close() { closed = true; clearTimeout(timer); try { client?.end(true) } catch {} }
  }
}

// ---- Laptop side ----
// handlers: onCommand(cmd), onStatus(status), getState()
export function startHost(code, { onCommand, onStatus, getState }) {
  const hs = randomId() // this laptop session's id; commands must echo it
  const out = makeSender(hs)
  const guard = makeGuard()
  const status = { peer: 'connecting', relay: 'connecting', mqtt: 'connecting', controller: null, controllerVia: null, lastSeen: 0, rejected: 0 }
  const emit = () => onStatus?.({ ...status })
  const conns = new Set()
  let closed = false, peer = null, nostr = null, mq = null, key = null, chanId = null
  let ctl = null // { sid, epub, hpub, pk, guard } - the one paired phone
  let ack = 0, bt = null

  const sendAll = async obj => {
    if (!key || closed) return
    const payload = await seal(key, out(obj))
    conns.forEach(c => { try { c.send(payload) } catch {} })
    nostr?.send(payload); mq?.send(payload)
  }
  // State goes out at most once per 40 ms and always carries who is in control and the last command accepted.
  const broadcast = () => { clearTimeout(bt); bt = setTimeout(() => sendAll({ t: 'state', ...getState(), hs, ctl: ctl?.sid || null, hpub: ctl?.hpub || null, ack }), 40) }
  const reject = () => { status.rejected++; emit() }
  const beat = setInterval(() => { if (!closed) broadcast() }, 10000) // keeps the phone in sync if a relay drops a message

  const receive = async (payload, via) => {
    let m
    try { m = await unseal(key, await payloadText(payload)) } catch { return } // not ours / wrong code
    if (!guard(m)) { reject(); return }
    if (m.t === 'hello') {
      if (typeof m.epub !== 'string') return
      if (!ctl) {
        const kp = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
        const hpub = b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
        if (ctl) return // another hello won the race while we were generating
        ctl = { sid: m.sid, epub: m.epub, hpub, pk: await commandKey(kp.privateKey, m.epub, chanId, hs, m.sid), guard: makeGuard() }
        status.controller = m.sid; log('host: controller paired via', via)
      }
      if (m.sid === ctl.sid && m.epub === ctl.epub) {
        status.controllerVia = via; status.lastSeen = Date.now(); emit()
        sendAll({ t: 'paired', to: ctl.sid, hpub: ctl.hpub })
        broadcast()
      } else if (m.sid === ctl.sid) {
        reject() // someone reusing the paired phone's id with a different key: ignore, don't disturb the real phone
      } else {
        sendAll({ t: 'busy', to: m.sid })
      }
    } else if (m.t === 'cmd') {
      if (!ctl || m.sid !== ctl.sid || typeof m.box !== 'string') { reject(); if (!ctl || m.sid !== ctl.sid) sendAll({ t: 'busy', to: m.sid }); return }
      let c
      try { c = await unseal(ctl.pk, m.box) } catch { reject(); return } // not sealed with the paired phone's own key
      if (c.sid === ctl.sid && c.hs === hs && typeof c.n === 'number' && c.n <= ack && c.n === ctl.lastN) { broadcast(); return } // phone re-sent a command we already applied: just confirm it again
      if (!ctl.guard(c) || c.sid !== ctl.sid || c.hs !== hs) { reject(); return }
      ctl.lastN = c.n
      status.controllerVia = via; status.lastSeen = Date.now(); emit()
      ack = c.n
      if (c.c !== 'ping') onCommand?.(c)
      broadcast()
    }
  }

  deriveSecrets(code).then(({ key: k, chan }) => {
    if (closed) return
    key = k; chanId = chan; log('host channel', chan.slice(0, 8))
    nostr = nostrTransport(chan, p => receive(p, 'Nostr relay'), st => { status.relay = st; emit(); if (st === 'ready') broadcast() })
    mq = mqttTransport(chan, 'p2l', 'l2p', p => receive(p, 'MQTT relay'), st => { status.mqtt = st; emit() })
    const openPeer = () => {
      if (closed) return
      peer = new Peer(`sunday-stroll-${chan}`, { debug: 0 })
      peer.on('open', () => { status.peer = 'ready'; emit() })
      peer.on('connection', conn => {
        conn.on('open', () => { conns.add(conn) })
        conn.on('data', p => receive(p, 'direct WebRTC'))
        const drop = () => { conns.delete(conn) }
        conn.on('close', drop); conn.on('error', drop)
      })
      peer.on('disconnected', () => { status.peer = 'reconnecting'; emit(); if (!closed) setTimeout(() => { try { peer.reconnect() } catch {} }, 1500) })
      peer.on('error', err => {
        status.peer = `error: ${err.type || err.message}`; emit()
        if (['network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id'].includes(err.type) && !closed) {
          try { peer.destroy() } catch {}
          setTimeout(openPeer, 3000)
        }
      })
    }
    openPeer()
  })

  return {
    broadcast,
    // Tell phones the session is over, then close everything.
    async stop() {
      clearInterval(beat)
      try { await sendAll({ t: 'bye' }) } catch {}
      closed = true
      setTimeout(() => {
        conns.forEach(c => { try { c.close() } catch {} })
        try { peer?.destroy() } catch {}
        nostr?.close(); mq?.close()
      }, 300)
    }
  }
}

// ---- Phone side ----
// onStatus({ state, via, detail }) where state is one of:
// 'deriving' | 'connecting' | 'waiting' | 'connected' | 'notfound' | 'busy' | 'ended'
export function startRemote(code, { onState, onStatus }) {
  let closed = false, key = null, chan = null, peer = null, conn = null, nostr = null, mq = null, retry = null, hello = null, nf = null, watch = null, stale = null
  let hs = null, lastStateAt = 0, via = null, state = 'deriving', detail = ''
  let me = null, pk = null, pairedHs = null, inner = null, lastHello = 0
  let pending = null // { n, at } - oldest command not yet acknowledged by the laptop
  const guard = makeGuard()
  let out = null
  const emit = () => onStatus?.({ state, via, detail })
  let waitingSince = 0
  const set = (s, d = '') => {
    if (s === 'waiting' && state !== 'waiting') waitingSince = Date.now()
    if (s === state && d === detail) return
    if (s !== state) log('phone ->', s)
    state = s; detail = d; emit()
  }
  const started = Date.now()
  const LOST = 'The laptop isn\'t confirming this phone\'s taps: the connection dropped, or the laptop no longer accepts this phone. Tap Retry. If that fails, scan the laptop\'s code again.'

  const send = async obj => {
    if (!key || closed || !out) return false
    const payload = await seal(key, out(obj))
    // Every transport, not only the first. On iPhone the WebRTC channel can look
    // open while the laptop never sees the hello; Nostr or MQTT still delivers it.
    // The laptop's replay guard applies a duplicate at most once.
    let sent = false
    if (conn?.open) { try { conn.send(payload); sent = true } catch {} }
    try { if (nostr?.ready) { await nostr.send(payload); sent = true } } catch {}
    try { if (mq?.ready) { mq.send(payload); sent = true } } catch {}
    return sent
  }
  const sendHello = () => { if (!me || Date.now() - lastHello < 2500) return; lastHello = Date.now(); send({ t: 'hello', epub: me.pub }) }
  const sendCmd = async c => {
    if (!pk) return
    const msg = inner({ ...c, hs: pairedHs })
    const box = await seal(pk, msg)
    if (c.c !== 'ping') { pending = { n: msg.n, at: pending?.at || Date.now(), box, tries: 1, last: Date.now() }; log('phone pending', c.c) }
    send({ t: 'cmd', box })
  }

  let chain = Promise.resolve()
  const receive = (payload, through) => {
    chain = chain.then(() => onHost(payload, through)).catch(err => log('phone receive', err?.message || err))
  }
  const onHost = async (payload, through) => {
    let m
    try { m = await unseal(key, await payloadText(payload)) } catch { return }
    if (!guard(m)) return
    const decision = applyPhoneMessage({ state, sid: out.sid, pk: !!pk, pairedHs, detail }, m)
    if (decision.dropPk) { pk = null; pairedHs = null }
    if (decision.derive) {
      try { pk = await commandKey(me.priv, decision.derive.hpub, chan, decision.derive.hs, out.sid); pairedHs = decision.derive.hs }
      catch { pk = null; pairedHs = null; set('waiting', 'Could not finish pairing. Tap Retry.'); return }
    }
    if (m.t === 'state') {
      hs = m.hs; lastStateAt = Date.now(); via = through
      if (pending && m.ack >= pending.n) { pending = null; log('phone acked') }
    }
    const waitingLong = state === 'waiting' && waitingSince && Date.now() - waitingSince > 8000
    set(decision.state, decision.state === 'waiting' && waitingLong ? WAITING_DETAIL : decision.detail)
    if (decision.hello) sendHello()
    if (decision.showState) onState(m)
    if (decision.stop) stop()
  }

  const connectPeer = () => {
    if (closed) return
    peer = new Peer({ debug: 0 })
    const again = ms => { clearTimeout(retry); retry = setTimeout(() => { try { peer?.destroy() } catch {} ; connectPeer() }, ms) }
    peer.on('open', () => {
      conn = peer.connect(`sunday-stroll-${chan}`, { reliable: true })
      const t = setTimeout(() => { if (!conn.open) again(5000) }, 15000)
      conn.on('open', () => { clearTimeout(t); lastHello = 0; sendHello() })
      conn.on('data', p => receive(p, 'direct WebRTC'))
      conn.on('close', () => { if (!closed) again(2000) })
    })
    peer.on('error', err => { log('phone peer error', err.type); if (!closed) again(err.type === 'peer-unavailable' ? 6000 : 3000) })
  }

  deriveSecrets(code).then(async s => {
    if (closed) return
    key = s.key; chan = s.chan
    // Same sender id and pairing key across reloads of this tab, so the laptop still recognises this phone.
    let sid = sessionStorage.getItem(`ssp_rsid_${chan}`)
    if (!sid) { sid = randomId(); sessionStorage.setItem(`ssp_rsid_${chan}`, sid) }
    me = await phoneKeypair(chan)
    const mk = makeSender(sid)
    out = obj => mk({ ...obj, hs }); out.sid = sid
    inner = makeSender(sid)
    set('connecting')
    nostr = nostrTransport(chan, p => receive(p, 'Nostr relay'), st => { if (st === 'ready') { if (state === 'connecting') set('waiting'); lastHello = 0; sendHello() } })
    mq = mqttTransport(chan, 'l2p', 'p2l', p => receive(p, 'MQTT relay'), st => { if (st === 'ready') sendHello() })
    connectPeer()
    // Until paired, keep saying hello on every transport; once paired, a light keep-alive.
    hello = setInterval(() => { if (closed) return; if (!pk && state !== 'busy' && state !== 'ended') sendHello(); else if (state === 'connected' && Date.now() % 20000 < 4000) sendCmd({ c: 'ping' }) }, 4000)
    nf = setInterval(() => {
      if (closed || state === 'busy' || state === 'ended' || state === 'connected') return
      if (!lastStateAt && Date.now() - started > 10000) set('notfound', 'No presenter answered this code. Check that the code matches the laptop, and that the laptop\'s Remote panel is open. Tap Retry.')
      else if (state === 'waiting' && waitingSince && Date.now() - waitingSince > 8000) set('waiting', WAITING_DETAIL)
    }, 1000)
    // A command not acknowledged within 6 s means the laptop no longer accepts this phone.
    watch = setInterval(() => {
      if (closed || !pending || state !== 'connected') return
      // relays can drop a message: re-send the same sealed command (the laptop applies it at most once)
      if (pending.tries < 4 && Date.now() - pending.last > 1800) { pending.tries++; pending.last = Date.now(); send({ t: 'cmd', box: pending.box }) }
      if (Date.now() - pending.at > 9000) set('lost', LOST)
    }, 500)
    // No state from the laptop for 25 s (it sends one every 10 s): assume it restarted and pair again.
    stale = setInterval(() => { if (!closed && state === 'connected' && Date.now() - lastStateAt > 25000) { pk = null; pairedHs = null; set('waiting', WAITING_DETAIL); lastHello = 0; sendHello() } }, 2000)
  })

  const stop = () => {
    closed = true; clearTimeout(retry); clearInterval(hello); clearInterval(nf); clearInterval(watch); clearInterval(stale)
    try { conn?.close() } catch {} ; try { peer?.destroy() } catch {} ; nostr?.close(); mq?.close()
  }
  const nudge = () => {
    if (closed || state === 'ended' || state === 'busy') return
    if (state === 'lost') { pk = null; pairedHs = null; set('waiting', '') }
    lastHello = 0
    sendHello()
  }
  return {
    send(cmd) { if (state === 'connected') sendCmd(cmd) },
    // Ask again without throwing away this phone's id. Used for Retry, wake, and reload recovery.
    nudge,
    repair() { stop() },
    stop
  }
}

// Lightweight copy of a slide for the phone preview (no picture data, to keep messages small).
export function lightSlide(s) {
  if (!s) return null
  return {
    id: s.id, title: s.title, body: s.body, edited: s.edited, layout: s.layout,
    bg: s.bg?.type === 'image' ? { type: 'color', color: '#223' } : s.bg,
    elements: (s.elements || []).map(e => (e.kind === 'image' ? { ...e, src: null } : e))
  }
}
