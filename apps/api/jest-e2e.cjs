/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup-env.cjs'],
  globalSetup: '<rootDir>/test/global-setup.cjs',
  testSequencer: '<rootDir>/test/e2e-sequencer.cjs',
  // Каждый e2e-файл — в свежем процессе воркера. Причина: file-type (pure ESM) грузится
  // рантайм-import()'ом, и Node кэширует модуль вместе с контекстом того jest-окружения,
  // которое импортировало его первым. После teardown этого окружения любой следующий
  // import() того же спецификатора падает с "import after the Jest environment has been
  // torn down" (ловили в files.integration, затем в chats). Мизерный лимит памяти
  // гарантированно превышается после каждого файла → воркер перезапускается, ESM-кэш
  // Node создаётся заново. Работает только в режиме воркера, поэтому --maxWorkers=1
  // вместо --runInBand (прогон остаётся последовательным).
  workerIdleMemoryLimit: '1MB',
  testTimeout: 30_000,
  moduleNameMapper: {
    '^@studenthub/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@studenthub/shared-config$': '<rootDir>/../../packages/shared-config/src/index.ts',
    '^@studenthub/shared-schemas$': '<rootDir>/../../packages/shared-schemas/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
