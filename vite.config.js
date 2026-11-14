import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// allowedHosts lets temporary public tunnels (e.g. Pinggy, Cloudflare quick tunnel, localtunnel) reach the server.
const allowedHosts = ['.trycloudflare.com', '.loca.lt', '.lhr.life', '.localhost.run', '.pinggy.link', '.serveousercontent.com', '.tunnelmole.net', '.pinggy-free.link', '.pinggy.net', '.pinggy.link', 'localhost']

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: true, port: 5173, allowedHosts },
  preview: { host: true, port: 4173, allowedHosts }
})
