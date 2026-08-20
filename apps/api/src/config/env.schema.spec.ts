import { validateEnv } from './env.schema'

// Минимально достаточный набор обязательных переменных — чтобы тесты проверяли ровно
// то, ради чего написаны, а не падали на отсутствии несвязанной переменной.
const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MINIO_ACCESS_KEY: 'key',
  MINIO_SECRET_KEY: 'secret',
  TOTP_ENCRYPTION_KEY: 'c'.repeat(64),
}

describe('validateEnv — необязательные переменные', () => {
  it('пустой SENTRY_DSN не роняет приложение', () => {
    // Регрессия: `.env.example` объявляет необязательные переменные пустыми
    // (`SENTRY_DSN=`), и на `z.string().url().optional()` это давало отказ валидации —
    // API не стартовал у любого, кто прошёл документированный сценарий первого запуска.
    const env = validateEnv({ ...base, SENTRY_DSN: '', SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' })

    expect(env.SENTRY_DSN).toBeUndefined()
    expect(env.SENTRY_ENVIRONMENT).toBeUndefined()
    expect(env.SENTRY_RELEASE).toBeUndefined()
  })

  it('пробелы вместо значения — тоже «не задано»', () => {
    expect(validateEnv({ ...base, SENTRY_DSN: '   ' }).SENTRY_DSN).toBeUndefined()
  })

  it('корректный DSN проходит', () => {
    const dsn = 'https://key@o1.ingest.sentry.io/2'

    expect(validateEnv({ ...base, SENTRY_DSN: dsn }).SENTRY_DSN).toBe(dsn)
  })

  it('заданный, но битый DSN всё ещё роняет старт — молчащий трекер хуже падения', () => {
    expect(() => validateEnv({ ...base, SENTRY_DSN: 'не-ссылка' })).toThrow(/SENTRY_DSN/)
  })

  it('доля трейсинга вне [0,1] отклоняется', () => {
    expect(() => validateEnv({ ...base, SENTRY_TRACES_SAMPLE_RATE: '5' })).toThrow()
    expect(validateEnv({ ...base, SENTRY_TRACES_SAMPLE_RATE: '' }).SENTRY_TRACES_SAMPLE_RATE).toBe(
      0,
    )
  })
})
