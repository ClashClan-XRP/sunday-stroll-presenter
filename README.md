# Sunday’s Walk Through The Week - Camp Carro

Proclaim-style web presenter for PPTX slideshows with realtime QR follow-along and daily devotionals generated from scriptures in the slides.

## Features

- Upload PPTX presentations
- Fullscreen presentation mode
- Mobile-friendly controls
- QR code on title/presenter view for public realtime follow-along
- Separate Devotionals page ("Sunday’s Walk Through The Week") that extracts Bible references from slides and generates daily reflections
- Dark theme with purple gradients and green/cyan accents inspired by Faithlife Proclaim

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173

Upload a .pptx file. A QR code will appear for audience follow-along (open the link in another tab/device).

## Realtime Notes

This MVP uses client-side parsing with `pptxtojson`. For true multi-device realtime sync (presenter advances → audience updates), deploy with a WebSocket server (Socket.io) or use a service like Supabase Realtime. Session IDs are already generated for this purpose.

## Sample Context

Built with the Ephesians 5 outline in mind (Camp Carroll / USAG Daegu style). Devotionals pull from verses like Ephesians 5:1-2, 5:3-4, etc.

## Deploy

- Vercel / Netlify for static + API routes
- Or add a Node backend for WebSockets

Styled after Proclaim: dark UI, vibrant accents, church-focused presentation experience.
