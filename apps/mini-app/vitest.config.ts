import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Отдельный конфиг от vite.config.ts: тому нужен прокси и allowedHosts туннелей, а
// тестам — окружение jsdom. Общий файл заставил бы каждый прогон тянуть настройки сервера.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
