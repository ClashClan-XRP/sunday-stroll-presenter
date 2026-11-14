// Phone-as-remote relay. No account needed. Three free public relays run side by side:
//  1) PeerJS (direct WebRTC data channel; signaling via the free PeerJS cloud server)
//  2) Nostr public relays (WSS on port 443, ephemeral events, works through most firewalls)
//  3) MQTT over WSS on public test brokers (ports 8084/8884/8081)
// Relay messages (2, 3) are AES-GCM encrypted with a key derived from the pairing code,
// so someone without the code can neither read the slides nor send commands.
// Public relays are best-effort; production should use a hosted relay (Firebase/Supabase or self-hosted).
import Peer from 'peerjs'
import mqtt from 'mqtt'
import { SimplePool } from 'nostr-tools/pool'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L
export function newPairCode(len = 8) {
  const a = new Uint32Array(len); crypto.getRandomValues(a)
  return [...a].map(n => ALPHABET[n % ALPHABET.length]).join('')
}
export const normalizeCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const peerIdFor = code => `sunday-stroll-${code.toLowerCase()}`
export const MQTT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt']
// Small in-page log for troubleshooting (window.__remoteLog)
const log = (...a) => { try { (window.__remoteLog ||= []).push(`${new Date().toISOString().slice(11, 23)} ${a.join(' ')}`) } catch {} }
const topic = (code, kind) => `sunday-stroll/v1/${code}/${kind}`


// ---- encryption keyed by the pairing code ----
const enc = new TextEncoder(), dec = new TextDecoder()
const keyCache = new Map()
async function keyFor(code) {
  if (!keyCache.has(code)) {
    keyCache.set(code, (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey'])
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('sunday-stroll-remote-v1'), iterations: 50000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    })())
  }
  return keyCache.get(code)
}
const b64 = u => btoa(String.fromCharCode(...u))
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
async function seal(code, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(code), enc.encode(JSON.stringify(obj))))
  return `${b64(iv)}.${b64(ct)}`
}
async function open_(code, text) {
  const [iv, ct] = text.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(code), unb64(ct))
  return JSON.parse(dec.decode(pt))
}
async function tagFor(code) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`sunday-stroll|${code}`)))
  return [...h.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('')
}

// ---- Nostr relay channel (ephemeral kind, never stored by relays) ----
export const NOSTR_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band']
const KIND = 21777
function nostrChannel(code, side, onMessage, onStatus) {
  const pool = new SimplePool({ enablePing: true, enableReconnect: true })
  const sk = generateSecretKey()
  const seen = new Set()
  let sub = null, closed = false, tag = null, up = 0
  const ready = (async () => {
    tag = await tagFor(code)
    sub = pool.subscribeMany(NOSTR_RELAYS, { kinds: [KIND], '#t': [tag], since: Math.floor(Date.now() / 1000) }, {
      onevent: async ev => {
        if (seen.has(ev.id)) return
        seen.add(ev.id)
        try { const m = await open_(code, ev.content); if (m.side !== side) onMessage(m.msg) } catch { /* wrong code or junk: ignore */ }
      },
      oneose: () => { up = 1; onStatus?.('ready') }
    })
    setTimeout(() => { if (!up && !closed) onStatus?.('unavailable') }, 10000)
  })()
  return {
    get ready() { return up === 1 },
    async send(msg) {
      await ready
      if (closed) return
      const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', tag]], content: await seal(code, { side, msg }) }, sk)
      const results = await Promise.allSettled(pool.publish(NOSTR_RELAYS, ev))
      if (results.some(r => r.status === 'fulfilled')) { if (!up) { up = 1; onStatus?.('ready') } } else onStatus?.('error')
    },
    close() { closed = true; try { sub?.close() } catch {} ; try { pool.close(NOSTR_RELAYS) } catch {} }
  }
}

function connectMqtt(onReady, onFail) {
  let i = 0, client = null, done = false
  const tryNext = () => {
    if (i >= MQTT_BROKERS.length) { onFail?.(); return }
    const url = MQTT_BROKERS[i++]
    client = mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 0, clean: true })
    const fail = () => { if (done) return; client.end(true); tryNext() }
    client.once('connect', () => {
      done = true
      client.options.reconnectPeriod = 3000 // auto-reconnect once a broker works
      onReady(client, url)
    })
    client.once('error', fail)
    setTimeout(() => { if (!done) fail() }, 7000)
  }
  tryNext()
  return () => client?.end(true)
}

// Laptop side. handlers: onCommand(cmd), onStatus({ peer, mqtt, phones }), getState()
export function startHost(code, { onCommand, onStatus, getState }) {
  const started = Date.now()
  const status = { peer: 'connecting', relay: 'connecting', mqtt: 'connecting', phones: 0 }
  const emit = () => onStatus?.({ ...status })
  const conns = new Set()
  let closed = false, peer = null, mq = null, stopMq = null

  const handle = msg => {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'hello') { if (msg.via === 'relay') status.relayPhone = Date.now(); broadcast(getState()); emit() }
    if (msg.t === 'cmd' && msg.via === 'relay' && Date.now() - started < 1500) return // ignore anything a relay replays right after we subscribe
    if (msg.t === 'cmd') { if (msg.via === 'relay') status.relayPhone = Date.now(); onCommand?.(msg) }
  }
  const nostr = nostrChannel(code, 'host', m => handle({ ...m, via: 'relay' }), st => { status.relay = st; emit() })
  const broadcast = state => {
    const msg = { t: 'state', ...state, ts: Date.now() }
    conns.forEach(c => { try { c.send(msg) } catch {} })
    nostr.send(msg)
    if (mq?.connected) seal(code, msg).then(p => mq.publish(topic(code, 'state'), p, { retain: true, qos: 0 }))
  }

  const openPeer = () => {
    if (closed) return
    peer = new Peer(peerIdFor(code), { debug: 0 })
    peer.on('open', () => { status.peer = 'ready'; emit() })
    peer.on('connection', conn => {
      log('host: incoming connection')
      conn.on('iceStateChanged', st => log('host ice', st))
      conn.on('open', () => { conns.add(conn); status.phones = conns.size; emit(); conn.send({ t: 'state', ...getState() }) })
      conn.on('data', handle)
      conn.on('close', () => { conns.delete(conn); status.phones = conns.size; emit() })
      conn.on('error', () => { conns.delete(conn); status.phones = conns.size; emit() })
    })
    peer.on('disconnected', () => { status.peer = 'reconnecting'; emit(); if (!closed) setTimeout(() => { try { peer.reconnect() } catch {} }, 1500) })
    peer.on('error', err => {
      log('host peer error', err.type)
      status.peer = `error: ${err.type || err.message}`; emit()
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id'].includes(err.type) && !closed) {
        try { peer.destroy() } catch {}
        setTimeout(openPeer, 3000)
      }
    })
  }
  openPeer()

  const retryMq = () => { if (!closed && !mq) stopMq = connectMqtt(onMq, onMqFail) }
  const onMq = (client, url) => {
    if (closed) { client.end(true); return }
    mq = client
    status.mqtt = 'ready'; status.broker = url; emit()
    client.subscribe(topic(code, 'cmd'))
    client.on('message', (_t, buf) => { open_(code, buf.toString()).then(m => handle({ ...m, via: 'relay' })).catch(() => {}) })
    client.on('close', () => { status.mqtt = 'reconnecting'; emit() })
    client.on('connect', () => { status.mqtt = 'ready'; emit() })
    broadcast(getState())
  }
  const onMqFail = () => { status.mqtt = 'unavailable'; emit(); if (!closed) setTimeout(retryMq, 30000) }
  stopMq = connectMqtt(onMq, onMqFail)

  return {
    broadcast,
    stop() {
      closed = true
      conns.forEach(c => { try { c.close() } catch {} })
      try { peer?.destroy() } catch {}
      if (mq?.connected) mq.publish(topic(code, 'state'), '', { retain: true }) // clear retained state
      nostr.close()
      stopMq?.()
    }
  }
}

// Phone side. handlers: onState(state), onStatus({ state, via })
// Direct WebRTC (PeerJS) and the Nostr relay start together; MQTT joins after 8 s if WebRTC isn't up.
// Commands go over exactly one link (WebRTC > Nostr > MQTT) so nothing is applied twice.
export function startRemote(code, { onState, onStatus }) {
  let closed = false, peer = null, conn = null, mq = null, stopMq = null, mqTimer = null, retry = null, lastState = 0, lastTs = 0
  const links = { peer: false, relay: false, mqtt: false }
  const via = () => (links.peer ? 'direct (WebRTC)' : links.relay ? 'Nostr relay' : links.mqtt ? 'MQTT relay' : null)
  let note = 'connecting'
  const emit = () => onStatus?.({ state: via() && lastState ? 'connected' : via() ? 'relay up, waiting for laptop' : note, via: via() })
  const gotState = m => { if (m?.t === 'state' && !(m.ts < lastTs)) { lastTs = m.ts || lastTs; log('phone state', m.idx); lastState = Date.now(); onState(m); emit() } }

  const nostr = nostrChannel(code, 'phone', gotState, st => { links.relay = st === 'ready'; emit(); if (links.relay && !links.peer) nostr.send({ t: 'hello' }) })
  // Re-ask for state every 10 s while only the relay is up and we have nothing yet
  const hello = setInterval(() => { if (!links.peer && !lastState) { nostr.send({ t: 'hello' }); if (mq?.connected) seal(code, { t: 'hello' }).then(p => mq.publish(topic(code, 'cmd'), p)) } }, 10000)

  const useMqtt = () => {
    if (closed || mq) return
    stopMq = connectMqtt((client, url) => {
      if (closed) { client.end(true); return }
      mq = client
      const up = () => { links.mqtt = true; emit(); seal(code, { t: 'hello' }).then(p => client.publish(topic(code, 'cmd'), p)) }
      client.subscribe(topic(code, 'state'))
      client.on('message', (_t, buf) => { if (links.peer) return; const s = buf.toString(); if (s) open_(code, s).then(gotState).catch(() => {}) })
      client.on('close', () => { links.mqtt = false; emit() })
      client.on('connect', up)
      up()
    }, () => { links.mqtt = false; emit(); if (!closed) setTimeout(() => { mq = null; useMqtt() }, 30000) })
  }

  const again = (ms = 3000) => { clearTimeout(retry); retry = setTimeout(() => { try { peer?.destroy() } catch {} ; connectPeer() }, ms) }
  const connectPeer = () => {
    if (closed) return
    peer = new Peer({ debug: 0 })
    peer.on('open', () => {
      log('phone: signaling open, dialing')
      conn = peer.connect(peerIdFor(code), { reliable: true })
      const t = setTimeout(() => { if (!conn.open) again(5000) }, 15000)
      conn.on('open', () => { clearTimeout(t); links.peer = true; emit(); conn.send({ t: 'hello' }) })
      conn.on('data', gotState)
      conn.on('error', e => log('phone conn error', e?.type || e?.message))
      conn.on('close', () => { links.peer = false; emit(); if (!closed) again(2000) })
    })
    peer.on('error', err => {
      log('phone peer error', err.type)
      if (closed) return
      if (err.type === 'peer-unavailable') note = 'laptop not found - check the code and that Remote is open on the laptop'
      again(err.type === 'peer-unavailable' ? 6000 : 3000)
      emit()
    })
  }
  connectPeer()
  mqTimer = setTimeout(() => { if (!links.peer) useMqtt() }, 8000)

  return {
    send(cmd) {
      const msg = { t: 'cmd', ...cmd, ts: Date.now() }
      if (links.peer && conn?.open) conn.send(msg)
      else if (links.relay) nostr.send(msg)
      else if (mq?.connected) seal(code, msg).then(p => mq.publish(topic(code, 'cmd'), p))
    },
    stop() {
      closed = true; clearTimeout(mqTimer); clearTimeout(retry); clearInterval(hello)
      try { conn?.close() } catch {} ; try { peer?.destroy() } catch {} ; stopMq?.(); nostr.close()
    }
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
