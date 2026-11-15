// Publishing a bulletin without git or Node.
//  1) Share link: the whole bulletin compressed (deflate-raw + base64url) into the URL hash (#z=...).
//     Works on any device with no server, but is ~3 KB: too long for a QR, so it's shared as a link.
//  2) Online copy: the same compressed bulletin is posted as a signed Nostr app-data event (kind 30078)
//     to free public relays. The short QR link carries only the session id and the publisher's public key,
//     so only this browser (which holds the private key) can publish or update that bulletin.
//     Public relays don't promise how long they keep data; the hosted copy (public/sessions) stays the most durable.
import { SimplePool } from 'nostr-tools/pool'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'

export const BULLETIN_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social', 'wss://offchain.pub', 'wss://nostr.oxtr.dev']
const KIND = 30078
const dTag = id => `sunday-stroll-bulletin:${id}`

const b64u = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}
export const bulletinPayload = pres => ({ t: pres.title, st: pres.sermonTitle, th: pres.theme, w: pres.weekOf, d: pres.devotionals, p: pres.publishedAt, o: (pres.slides || []).map(s => s.title) })
export function fromPayload(o) {
  return { title: o.t, sermonTitle: o.st, theme: o.th, weekOf: o.w, devotionals: o.d, publishedAt: o.p, status: 'published', slides: (o.o || []).map((title, i) => ({ id: `o${i}`, title })) }
}
export async function compress(pres) {
  return b64u(await pipe(new TextEncoder().encode(JSON.stringify(bulletinPayload(pres))), new CompressionStream('deflate-raw')))
}
export async function decompress(str) {
  try { return fromPayload(JSON.parse(new TextDecoder().decode(await pipe(unb64u(str), new DecompressionStream('deflate-raw'))))) } catch { return null }
}

// Publisher identity for this browser (kept in localStorage; it never leaves the device).
function publisherKey() {
  let hex = localStorage.getItem('ssp_publisher_sk')
  if (!hex) { hex = bytesToHex(generateSecretKey()); localStorage.setItem('ssp_publisher_sk', hex) }
  const sk = hexToBytes(hex)
  return { sk, pub: getPublicKey(sk) }
}
export const pubToShort = hex => b64u(hexToBytes(hex))
export const shortToPub = s => { try { const u = unb64u(s); return u.length === 32 ? bytesToHex(u) : null } catch { return null } }
// Short QR links carry only the first 10 base64url characters (60 bits) of the publisher key: ?b=ID.FINGERPRINT
// Viewers accept only events whose (signature-checked) author key starts with that fingerprint.
export const FP_LEN = 10
export const fingerprintOf = hex => pubToShort(hex).slice(0, FP_LEN)

// ---- events this browser published, kept so they can be re-posted (keep-alive) and deleted ----
const EV_KEY = 'ssp_online_events', ST_KEY = 'ssp_online_status'
const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
export const onlineStatus = id => readJson(ST_KEY)[id] || null
const setStatus = (id, st) => { const all = readJson(ST_KEY); if (st) all[id] = st; else delete all[id]; writeJson(ST_KEY, all); window.dispatchEvent(new CustomEvent('ssp-online', { detail: id })) }

function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]) }
async function postEvent(ev) {
  const pool = new SimplePool()
  const results = await Promise.allSettled(pool.publish(BULLETIN_RELAYS, ev).map(x => withTimeout(x, 8000)))
  setTimeout(() => { try { pool.close(BULLETIN_RELAYS) } catch {} }, 500)
  return results.filter(r => r.status === 'fulfilled').length
}

// How many relays currently return this exact event.
export async function countHolders(ev) {
  const pool = new SimplePool()
  const one = url => new Promise(resolve => {
    let got = false
    const sub = pool.subscribeMany([url], { ids: [ev.id] }, { onevent: () => { got = true }, oneose: () => { try { sub.close() } catch {} ; resolve(got) } })
    setTimeout(() => { try { sub.close() } catch {} ; resolve(got) }, 7000)
  })
  const res = await Promise.all(BULLETIN_RELAYS.map(one))
  setTimeout(() => { try { pool.close(BULLETIN_RELAYS) } catch {} }, 300)
  return res.filter(Boolean).length
}

export async function publishOnline(pres) {
  const { sk, pub } = publisherKey()
  const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', dTag(pres.id)], ['client', 'sunday-stroll']], content: await compress(pres) }, sk)
  const ok = await postEvent(ev)
  const evs = readJson(EV_KEY); evs[pres.id] = ev; writeJson(EV_KEY, evs)
  const r = { ok, total: BULLETIN_RELAYS.length, a: pubToShort(pub), f: fingerprintOf(pub), at: new Date().toISOString() }
  setStatus(pres.id, { held: ok, total: BULLETIN_RELAYS.length, checkedAt: r.at, postedAt: r.at, publishedAt: r.at })
  return r
}

// Keep-alive: while the presenter's browser is open, re-post each recent bulletin's signed event to every relay
// (the same event, so viewers see no change) and record how many relays hold it.
export const KEEP_DAYS = 8
export async function keepAlive(onlyId) {
  const evs = readJson(EV_KEY)
  for (const [id, ev] of Object.entries(evs)) {
    if (onlyId && id !== onlyId) continue
    if (Date.now() / 1000 - ev.created_at > KEEP_DAYS * 86400) continue
    const prev = onlineStatus(id) || {}
    const before = await countHolders(ev)
    if (before < BULLETIN_RELAYS.length) await postEvent(ev)
    const held = before < BULLETIN_RELAYS.length ? await countHolders(ev) : before
    setStatus(id, { ...prev, held, total: BULLETIN_RELAYS.length, checkedAt: new Date().toISOString(), postedAt: before < BULLETIN_RELAYS.length ? new Date().toISOString() : prev.postedAt })
  }
}

// F5: remove the online copy. Sends a NIP-09 deletion for the event and its address, and also replaces the
// replaceable event with an empty "deleted" version for relays that ignore deletion requests.
export async function deleteOnline(id, skHex) {
  const evs = readJson(EV_KEY)
  const ev = evs[id]
  const sk = skHex ? hexToBytes(skHex) : publisherKey().sk
  const pub = getPublicKey(sk)
  if (ev && ev.pubkey !== pub) return { ok: 0, error: 'This bulletin was published from a different browser.' }
  const now = Math.floor(Date.now() / 1000)
  const tombstone = finalizeEvent({ kind: KIND, created_at: Math.max(now, (ev?.created_at || 0) + 1), tags: [['d', dTag(id)], ['deleted', '1'], ['client', 'sunday-stroll']], content: '' }, sk)
  const del = finalizeEvent({ kind: 5, created_at: now, tags: [...(ev ? [['e', ev.id]] : []), ['e', tombstone.id], ['a', `${KIND}:${pub}:${dTag(id)}`], ['k', String(KIND)]], content: 'Sunday Stroll bulletin removed by the presenter' }, sk)
  const okT = await postEvent(tombstone)
  const okD = await postEvent(del)
  delete evs[id]; writeJson(EV_KEY, evs); setStatus(id, null)
  return { ok: Math.max(okT, okD), total: BULLETIN_RELAYS.length }
}

// ---- viewer side: find the bulletin, retrying with backoff (about 25 s in total) ----
const inflight = new Map()
export function fetchOnline(id, who, onProgress) {
  const k = `${id}|${who?.a || ''}|${who?.f || ''}`
  if (!inflight.has(k)) inflight.set(k, fetchWithRetry(id, who, p => (inflight.get(k)?.listeners || []).forEach(fn => fn(p))).finally(() => setTimeout(() => inflight.delete(k), 2000)))
  const pr = inflight.get(k)
  ;(pr.listeners ||= []).push(onProgress || (() => {}))
  return pr
}
const ATTEMPTS = [6000, 8000, 9000] // per-attempt wait; with 1 s and 2 s gaps = ~26 s
async function fetchWithRetry(id, who, progress) {
  let reached = 0, sawDeleted = false
  for (let i = 0; i < ATTEMPTS.length; i++) {
    progress({ attempt: i + 1, of: ATTEMPTS.length })
    const r = await fetchOnce(id, who, ATTEMPTS[i])
    reached = Math.max(reached, r.reached)
    if (r.deleted) sawDeleted = true
    if (r.pres) return { pres: r.pres }
    if (sawDeleted) break
    if (i < ATTEMPTS.length - 1) await new Promise(res => setTimeout(res, 1000 * (i + 1)))
  }
  const total = BULLETIN_RELAYS.length
  const reason = sawDeleted ? 'deleted'
    : reached === 0 ? 'unreachable'
    : 'missing'
  return { pres: null, reason, reached, total }
}
function fetchOnce(id, who, waitMs) {
  const full = who?.a ? shortToPub(who.a) : null
  const fp = who?.f || null
  if (!full && !fp) return Promise.resolve({ pres: null, reached: 0 })
  const filter = full ? { kinds: [KIND], authors: [full], '#d': [dTag(id)] } : { kinds: [KIND], '#d': [dTag(id)], limit: 200 }
  const mine = ev => (full ? ev.pubkey === full : pubToShort(ev.pubkey).startsWith(fp))
  const pool = new SimplePool()
  const answered = new Set(), failed = new Set()
  return new Promise(resolve => {
    let best = null, done = false, sub = null, grace = null
    const finish = async () => {
      if (done) return
      done = true
      try { sub?.close() } catch {}
      setTimeout(() => { try { pool.close(BULLETIN_RELAYS) } catch {} }, 300)
      if (!best) return resolve({ pres: null, reached: answered.size })
      if (best.tags.some(t => t[0] === 'deleted') || !best.content) return resolve({ pres: null, deleted: true, reached: answered.size })
      const pres = await decompress(best.content)
      resolve({ pres: pres ? { ...pres, id } : null, reached: answered.size })
    }
    // one subscription per relay so we know which ones answered
    const subs = BULLETIN_RELAYS.map(url => pool.subscribeMany([url], filter, {
      onevent: ev => {
        answered.add(url)
        if (!mine(ev)) return
        if (!best || ev.created_at > best.created_at) best = ev
        if (!grace) grace = setTimeout(finish, 1500)
      },
      // EOSE also fires when a relay connection fails; only count relays that are really connected
      oneose: () => { if (!failed.has(url) && [...pool.listConnectionStatus()].some(([u, up]) => up && u.replace(/\/$/, '') === url)) answered.add(url); if (best && !grace) grace = setTimeout(finish, 800) },
      onclose: () => { failed.add(url) }
    }))
    sub = { close: () => subs.forEach(s => { try { s.close() } catch {} }) }
    setTimeout(finish, waitMs)
  })
}
