/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  // Репортёры покрытия (действуют только при --coverage): text-summary печатает итог в
  // лог шага, json-summary даёт машиночитаемый файл — из него прогон собирает таблицу в
  // сводке запуска, lcov остаётся для просмотра в браузере локально.
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  // Каталог отчёта задан явно. По умолчанию jest кладёт его рядом с rootDir, а rootDir
  // здесь — src, то есть отчёт уезжал в apps/api/src/coverage. Туда не смотрит ни
  // outputs в turbo.json, ни скрипт clean, ни шаг прогона, который строит таблицу.
  coverageDirectory: '../coverage',
  // Workspace-пакеты собираются в ESM; в jest (CommonJS) резолвим их исходники
  // и снимаем .js-расширения из NodeNext-импортов, чтобы ts-jest компилировал .ts.
  moduleNameMapper: {
    '^@studenthub/shared-types$': '<rootDir>/../../../packages/shared-types/src/index.ts',
    '^@studenthub/shared-config$': '<rootDir>/../../../packages/shared-config/src/index.ts',
    '^@studenthub/shared-schemas$': '<rootDir>/../../../packages/shared-schemas/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
