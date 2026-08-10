import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Тест-раннер фронта (P1.2 плана чатов): jsdom + Testing Library.
// Алиасы дублируют paths из tsconfig.json (FSD-слои).
const alias = (p: string): string => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      shared: alias('shared'),
      entities: alias('entities'),
      features: alias('features'),
      widgets: alias('widgets'),
      views: alias('views'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
