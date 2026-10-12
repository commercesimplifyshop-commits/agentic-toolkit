import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The NestJS API (apps/api) listens on 4310
    proxy: { '/api': 'http://127.0.0.1:4310' },
  },
})
