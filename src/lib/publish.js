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

export async function publishOnline(pres) {
  const { sk, pub } = publisherKey()
  const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', dTag(pres.id)], ['client', 'sunday-stroll']], content: await compress(pres) }, sk)
  const pool = new SimplePool()
  const results = await Promise.allSettled(pool.publish(BULLETIN_RELAYS, ev).map(p => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))])))
  setTimeout(() => { try { pool.close(BULLETIN_RELAYS) } catch {} }, 500)
  const ok = results.filter(r => r.status === 'fulfilled').length
  return { ok, total: BULLETIN_RELAYS.length, a: pubToShort(pub), at: new Date().toISOString() }
}

const inflight = new Map()
export function fetchOnline(id, a, waitMs = 10000) {
  const k = `${id}|${a}`
  if (!inflight.has(k)) inflight.set(k, fetchOnce(id, a, waitMs).finally(() => setTimeout(() => inflight.delete(k), 2000)))
  return inflight.get(k)
}
function fetchOnce(id, a, waitMs) {
  const pub = shortToPub(a)
  if (!pub) return Promise.resolve(null)
  const pool = new SimplePool()
  return new Promise(resolve => {
    let best = null, done = false, sub = null
    const finish = async () => {
      if (done) return
      done = true
      try { sub?.close() } catch {}
      setTimeout(() => { try { pool.close(BULLETIN_RELAYS) } catch {} }, 300)
      resolve(best ? { ...(await decompress(best.content)), id } : null)
    }
    let grace = null
    sub = pool.subscribeMany(BULLETIN_RELAYS, { kinds: [KIND], authors: [pub], '#d': [dTag(id)] }, {
      onevent: ev => {
        if (ev.pubkey !== pub) return
        if (!best || ev.created_at > best.created_at) best = ev
        // a relay answered: give the others a moment to offer a newer version, then show it
        if (!grace) grace = setTimeout(finish, 1200)
      },
      oneose: () => { if (best) finish() }
    })
    setTimeout(finish, waitMs)
  })
}
