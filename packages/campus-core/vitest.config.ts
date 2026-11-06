import { defineConfig } from 'vitest/config'

// Чистая геометрия без DOM — окружение node. Покрытие считается по исходникам пакета.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: { include: ['src/**/*.ts'], exclude: ['src/index.ts'] },
  },
})
