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
