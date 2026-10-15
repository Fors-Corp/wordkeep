import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = import.meta.dirname

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // three.js (the atlas) is one lazily loaded chunk of about 560 kB; everything else is far smaller.
    chunkSizeWarningLimit: 600,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(root, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3001',
    },
  },
})
