import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// Excalidraw (whiteboard) loads fonts and translations at runtime. Serve them from
// StoreFlow itself instead of a CDN, so the board also works offline.
const require = createRequire(import.meta.url)
const excalidrawAssets = path.join(path.dirname(require.resolve('@excalidraw/excalidraw/package.json')), 'dist', 'excalidraw-assets')
const publicAssets = path.join(__dirname, 'public', 'excalidraw-assets')
if (fs.existsSync(excalidrawAssets) && !fs.existsSync(publicAssets)) fs.cpSync(excalidrawAssets, publicAssets, { recursive: true })

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The NestJS API (apps/api) listens on 4310
    proxy: { '/api': 'http://127.0.0.1:4310' },
  },
})
