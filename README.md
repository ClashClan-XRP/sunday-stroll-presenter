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

1. On the laptop open the presentation, click **📱 Remote**. A pairing code (8 random characters) and a small QR appear.
2. On the phone scan that QR (or open `https://clashclan-xrp.github.io/sunday-stroll-presenter/?remote` and type the code).
3. Click **Present Fullscreen** on the laptop. The phone shows the current and next slide, notes, Prev / Next, a jump list and Black screen. The laptop keyboard and clicker keep working; the phone follows along.

How it connects: the laptop opens three free public relays at once and the phone uses whichever works first:
direct WebRTC via the PeerJS cloud, Nostr public relays (port 443, works through most firewalls), and public MQTT brokers.
Relay traffic is encrypted with a key derived from the pairing code, so nobody without the code can read it or send commands.
These public relays are best-effort with no uptime guarantee; for production use Firebase/Supabase or a self-hosted relay.

## Fullscreen controls

Next: → ↓ PageDown Space Enter N, click/tap the right half, swipe left. Back: ← ↑ PageUp Backspace P, click/tap the left half, swipe right.
Home/End jump to the first/last slide, B or . toggles a black screen, Esc exits. Most presentation clickers send PageUp/PageDown and work as-is.

## PPTX import fidelity

Kept from the uploaded file: pictures (compressed if large), solid / gradient / picture backgrounds, text boxes with their fonts, colors and positions,
filled shapes, groups, and pictures from the slide layout/master. Not rendered: tables, charts, SmartArt, video/audio, and complex shape outlines.
If you edit a slide's text in Review / Edit, that slide switches to a simple text layout (you can restore the original).
Large picture-heavy decks may hit the browser's local storage limit (about 5 MB); pictures are then dropped from the saved copy.
