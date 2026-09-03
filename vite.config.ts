import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base works for both file:// (Electron) and a GitHub Pages subpath.
  base: process.env.VITE_BASE_PATH ?? './',
})
