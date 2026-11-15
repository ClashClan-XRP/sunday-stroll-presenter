# Sunday Stroll Through The Week - Camp Carroll

Proclaim-style web presenter for PPTX slideshows with realtime QR follow-along and daily devotionals generated from scriptures in the slides.

## Live demo (GitHub Pages)

- Presenter / archive: https://clashclan-xrp.github.io/sunday-stroll-presenter/
- Published test bulletin (Sermon_Dev, Peace on the Family Front, Eph 5:22-6:4): https://clashclan-xrp.github.io/sunday-stroll-presenter/?session=60YROW7M&mode=bulletin

Deploy: `npm run build`, then publish `dist/` to the `gh-pages` branch (Pages source = gh-pages /). Published sessions placed in `public/sessions/` (plus `index.json`) load on any device.

## Features

- Upload PPTX presentations
- Fullscreen presentation mode
- Mobile-friendly controls
- QR code on title/presenter view for public realtime follow-along
- Separate Devotionals page ("Sunday Stroll Through The Week") that extracts Bible references from slides and generates daily reflections
- Dark theme with purple gradients and green/cyan accents inspired by Faithlife Proclaim

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173

Upload a .pptx file. A QR code will appear for audience follow-along (open the link in another tab/device).

## Flow

1. Host archive at `/` - upload a PPTX, see every previous presentation (draft/published) with Review/Edit, Present, Bulletin, Delete.
2. Review/Edit (`?session=ID&mode=edit`) - edit title, week theme, sermon Sunday, slides (reorder/add/delete), and 7 daily devotionals. Scripture uses structured fields: book, chapter, verse start/end, Bible version.
3. Publish - locks edits, shows a QR code that opens the bulletin; the same QR appears on the title slide in the presenter and fullscreen views.
4. Bulletin (`?session=ID&mode=bulletin`) - all-week devotionals with Print day / Download day, Print week / Download week (.html, .txt). "Copy share link" makes a portable link that works on any device without a backend.
5. Presenter downloads: PPTX (pptxgenjs) and PDF (browser print-to-PDF).

Storage is browser localStorage for this MVP; a shared backend is required for the archive and short bulletin link to work across devices.

## Realtime Notes (deferred)

This MVP uses client-side parsing with `pptxtojson`. For true multi-device realtime sync (presenter advances → audience updates), deploy with a WebSocket server (Socket.io) or use a service like Supabase Realtime. Session IDs are already generated for this purpose.

## Sample Context

Built with the Ephesians 5 outline in mind (Camp Carroll / USAG Daegu style). Devotionals pull from verses like Ephesians 5:1-2, 5:3-4, etc.

## Deploy

- Vercel / Netlify for static + API routes
- Or add a Node backend for WebSockets

Styled after Proclaim: dark UI, vibrant accents, church-focused presentation experience.

## Phone as remote (no account needed)

1. On the laptop open the presentation, click **📱 Remote**. A pairing code (18 random characters, about 89 bits, shown as XXXXXX-XXXXXX-XXXXXX) and a small QR appear.
2. On the phone scan that QR (or open `https://clashclan-xrp.github.io/sunday-stroll-presenter/?remote` and type the code).
3. The code panel hides itself as soon as the phone pairs, and it is never part of the fullscreen output, so it doesn't show on a mirrored projector.
4. Click **Present Fullscreen**. The phone shows the current and next slide, notes, Prev / Next, a jump list and Black screen. The laptop keyboard and clicker keep working.
5. **Disconnect / New code** ends the session for the phone and makes a fresh code. Only one phone can control at a time; a second phone is told someone else is in control.

How it connects: the laptop listens on three free public relays at once and the phone uses whichever works first:
direct WebRTC via the PeerJS cloud, Nostr public relays (port 443, works through most firewalls), and public MQTT brokers.

Security: the code itself is never sent. PBKDF2-SHA256 (310,000 iterations) + HKDF with separate labels derive an AES-GCM key and a separate channel id;
the channel id names the PeerJS peer, the Nostr tag and the MQTT topics (never retained). Every message is encrypted and authenticated, and carries a
sender id, a strictly increasing counter tied to its timestamp (they may differ by at most 5 s) and a timestamp, so duplicates, replays and stale messages are dropped.

Per-phone key: when a phone pairs it sends a fresh ECDH P-256 public key; the laptop answers with its own ephemeral key and both derive a per-phone
AES-GCM command key (HKDF, bound to the laptop session and the phone's id). Slide commands are sealed with that key, so someone else who knows the
pairing code cannot move slides or take control by copying the phone's id. If the laptop stops confirming the phone's taps (for about 9 s) the phone shows
**Connection lost, re-pair** with a **Re-pair** button; if the laptop restarted, the phone re-pairs by itself. Public relays are best-effort with no uptime
guarantee; for production use Firebase/Supabase or a self-hosted relay.

## Publishing the bulletin for phones (no git or Node)

Click **Publish** in Review / Edit. The bulletin is compressed and posted as a signed app-data event to six free public Nostr relays, and the QR becomes a short
link (`?b=ID.FP`, where FP is a short fingerprint of the publisher key) that any phone can open. Only the browser that published it holds the signing key, so nobody
else can change it. If a hosted copy exists in `public/sessions/`, the QR uses `?b=ID` instead.

- The editor shows how many relays hold the bulletin (**Check now** re-counts). While the publishing browser is open it re-checks every 20 minutes and re-posts to relays that dropped it.
- An online QR is good for about a week; relays don't promise longer. For anything longer use **Export for hosting**.
- On the phone, the bulletin retries across all relays for up to about 25 s with a progress message; if it still fails it says why (removed, relays unreachable, or not found) and offers **Try again**.
- **Remove online copy** (and deleting the presentation on Home) sends a NIP-09 deletion plus an empty replacement, so phones then see "The presenter removed this bulletin".
- **Share bulletin link** copies a self-contained compressed link (about 1.5–3.5 KB, too long for a QR) that works with no relay at all.

## Fullscreen controls

Next: → ↓ PageDown Space Enter N, click/tap the right half, swipe left. Back: ← ↑ PageUp Backspace P, click/tap the left half, swipe right.
Home/End jump to the first/last slide, B or . toggles a black screen, Esc exits. Most presentation clickers send PageUp/PageDown and work as-is.

## PPTX import fidelity

Kept from the uploaded file: pictures (compressed if large), solid / gradient / picture backgrounds, text boxes with their fonts, colors and positions,
filled shapes, groups, and pictures from the slide layout/master. Not rendered: tables, charts, SmartArt, video/audio, and complex shape outlines.
If you edit a slide's text in Review / Edit, that slide switches to a simple text layout (you can restore the original).
Large picture-heavy decks may hit the browser's local storage limit (about 5 MB); pictures are then dropped from the saved copy.
