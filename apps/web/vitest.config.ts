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
    // Покрытие считается только при --coverage. Репортёры те же, что у api: text-summary
    // печатает итог в лог шага, json-summary читает прогон и кладёт таблицу в сводку
    // запуска, html остаётся для просмотра локально.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      // Только исходники приложения. Без этого vitest берёт в знаменатель всё, что найдёт
      // по умолчанию, включая вывод сборки в .next — первый прогон насчитал 158 тысяч
      // инструкций и 8% покрытия, то есть мерил не то.
      include: ['src/**/*.{ts,tsx}'],
      // Тесты, конфиги и сгенерированный код в знаменателе только портят картину.
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        '**/node_modules/**',
        'e2e/**',
        '*.config.{ts,mjs,js}',
      ],
    },
  },
})
