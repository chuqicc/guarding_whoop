import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // .tsx must be included — component tests were silently skipped before.
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
