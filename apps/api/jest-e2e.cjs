/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup-env.cjs'],
  globalSetup: '<rootDir>/test/global-setup.cjs',
  // Integration-тесты (реальный MinIO + динамический ESM-импорт file-type) — последними,
  // иначе их ленивый import() резолвится после teardown следующего suite (см. e2e-sequencer.cjs).
  testSequencer: '<rootDir>/test/e2e-sequencer.cjs',
  testTimeout: 30_000,
  moduleNameMapper: {
    '^@studenthub/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@studenthub/shared-config$': '<rootDir>/../../packages/shared-config/src/index.ts',
    '^@studenthub/shared-schemas$': '<rootDir>/../../packages/shared-schemas/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
