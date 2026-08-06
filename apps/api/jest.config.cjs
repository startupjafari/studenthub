/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  // Workspace-пакеты собираются в ESM; в jest (CommonJS) резолвим их исходники
  // и снимаем .js-расширения из NodeNext-импортов, чтобы ts-jest компилировал .ts.
  moduleNameMapper: {
    '^@studenthub/shared-types$': '<rootDir>/../../../packages/shared-types/src/index.ts',
    '^@studenthub/shared-config$': '<rootDir>/../../../packages/shared-config/src/index.ts',
    '^@studenthub/shared-schemas$': '<rootDir>/../../../packages/shared-schemas/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
