import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages needs /basketball-annotation/; Railway serves from root
  base: process.env.VITE_BASE_PATH ?? '/basketball-annotation/',
  server: {
    proxy: {
      // Forward /api/* to the local split-server so the browser sees same origin
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
