import { describe, expect, it } from 'vitest'
import { sharedSentryOptions } from './sentry-options'

// Ф13.8. Проверяем не SDK, а нашу политику приватности на фронте (§11.3):
// что уходит наружу и что вырезается. Ослабление этих проверок = утечка.
describe('sharedSentryOptions', () => {
  const options = sharedSentryOptions()

  // `type: undefined` — обязательное поле ErrorEvent, отличающее ошибку от транзакции.
  const send = (request: { url: string; data?: unknown }) =>
    options.beforeSend({ type: undefined, request })

  it('не отправляет IP, cookie и заголовки авторизации', () => {
    expect(options.sendDefaultPii).toBe(false)
  })

  it('трейсинг производительности выключен по умолчанию', () => {
    expect(options.tracesSampleRate).toBe(0)
  })

  it('Session Replay не подключён — это была бы запись чужой переписки', () => {
    // Интеграции вообще не перечисляем: SDK берёт дефолтные, а Replay в них не входит.
    expect(Object.keys(options)).not.toContain('integrations')
  })

  it('вырезает тело запроса из события', () => {
    const event = send({ url: 'https://studenthub.app/documents', data: { number: 'AB1234567' } })

    expect(event.request).not.toHaveProperty('data')
  })

  it('прячет токен приглашения из URL', () => {
    const event = send({ url: 'https://studenthub.app/register?token=secret' })

    expect(event.request?.url).toBe('https://studenthub.app/register?token=[Filtered]')
  })

  it('чистит URL в хлебных крошках до попадания в событие', () => {
    const crumb = options.beforeBreadcrumb({
      category: 'fetch',
      data: { url: '/api/v1/student-id/verify?token=qr' },
    })

    expect(crumb.data?.url).toBe('/api/v1/student-id/verify?token=[Filtered]')
  })

  // Регрессия: у крошки навигации URL лежит в from/to. Пока чистился только url,
  // токен приглашения уезжал в трекер (нашлось прогоном SDK в реальном браузере).
  it('чистит from/to у крошки навигации', () => {
    const crumb = options.beforeBreadcrumb({
      category: 'navigation',
      data: { from: '/register?token=secret', to: '/register?token=secret' },
    })

    expect(crumb.data).toEqual({
      from: '/register?token=[Filtered]',
      to: '/register?token=[Filtered]',
    })
  })

  it('не трогает крошки без URL', () => {
    const crumb = options.beforeBreadcrumb({ category: 'console', message: 'hi' })

    expect(crumb.message).toBe('hi')
  })

  it('игнорирует шум, на который мы не влияем (обрыв сети, расширения браузера)', () => {
    expect(options.ignoreErrors).toContain('Failed to fetch')
    expect(options.ignoreErrors.some((p) => String(p).includes('extension'))).toBe(true)
  })
})
