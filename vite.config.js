import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

// allowedHosts lets temporary public tunnels (e.g. Pinggy, Cloudflare quick tunnel, localtunnel) reach the server.
const allowedHosts = ['.trycloudflare.com', '.loca.lt', '.lhr.life', '.localhost.run', '.pinggy.link', '.serveousercontent.com', '.tunnelmole.net', '.pinggy-free.link', '.pinggy.net', '.pinggy.link', 'localhost']

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        presenter: resolve(root, 'presenter.html'),
        remote: resolve(root, 'remote.html'),
        bulletin: resolve(root, 'bulletin.html'),
        qr: resolve(root, 'qr.html')
      }
    }
  },
  server: { host: true, port: 5173, allowedHosts },
  preview: { host: true, port: 4173, allowedHosts }
})
