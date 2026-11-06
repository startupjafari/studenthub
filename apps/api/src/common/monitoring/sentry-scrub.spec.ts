import type { ErrorEvent } from '@sentry/nestjs'
import { LINK_PREVIEW_USER_AGENT } from '../link-preview/link-preview-agent'
import { scrubBreadcrumb, scrubEvent, scrubTransaction } from './sentry-scrub'

// Ф13.8. Этот тест — гарантия §14.9/§11.3 для внешнего трекера: если он падает,
// значит в Sentry может уехать секрет или персональные данные. Ослаблять нельзя.
describe('scrubEvent', () => {
  const baseEvent = (): ErrorEvent => ({ event_id: 'e1', type: undefined })

  it('вырезает тело запроса целиком — там ФИО, номера документов, текст сообщений', () => {
    const event = scrubEvent({
      ...baseEvent(),
      request: {
        url: 'https://studenthub.app/api/v1/documents',
        method: 'POST',
        data: { number: 'AB1234567', firstName: 'Айгерим' },
      },
    })

    expect(event?.request).toBeDefined()
    expect(event?.request).not.toHaveProperty('data')
  })

  it('вырезает cookie и Authorization даже если SDK их приложил', () => {
    const event = scrubEvent({
      ...baseEvent(),
      request: {
        url: 'https://studenthub.app/api/v1/me',
        cookies: { sh_refresh: 'secret-uuid' },
        headers: {
          Authorization: 'Bearer eyJhb...',
          Cookie: 'sh_refresh=secret-uuid',
          'user-agent': 'Mozilla/5.0',
        },
      },
    })

    expect(event?.request).not.toHaveProperty('cookies')
    expect(event?.request?.headers).toEqual({ 'user-agent': 'Mozilla/5.0' })
  })

  it('заменяет значение ?token= — это одноразовый пароль на регистрацию', () => {
    const event = scrubEvent({
      ...baseEvent(),
      request: { url: 'https://studenthub.app/register?token=abc123&locale=ru' },
    })

    expect(event?.request?.url).toBe('https://studenthub.app/register?token=[Filtered]&locale=ru')
  })

  it('прячет токен инвайта из сегмента пути и из имени транзакции', () => {
    const event = scrubEvent({
      ...baseEvent(),
      transaction: 'GET /api/v1/invites/9f8a7b6c5d/preview',
      request: { url: 'https://studenthub.app/api/v1/invites/9f8a7b6c5d/preview' },
    })

    expect(event?.transaction).toBe('GET /api/v1/invites/[token]/preview')
    expect(event?.request?.url).not.toContain('9f8a7b6c5d')
  })

  it('чистит query_string отдельно от url (Fastify отдаёт его полем)', () => {
    const event = scrubEvent({
      ...baseEvent(),
      request: { url: '/api/v1/student-id/verify', query_string: 'token=qr-secret&limit=10' },
    })

    expect(event?.request?.query_string).toBe('token=[Filtered]&limit=10')
  })

  it('чистит URL в хлебных крошках', () => {
    const event = scrubEvent({
      ...baseEvent(),
      breadcrumbs: [
        { category: 'fetch', data: { url: '/register?token=leak', status_code: 500 } },
        { category: 'console', message: 'no url here' },
      ],
    })

    expect(event?.breadcrumbs?.[0]?.data?.url).toBe('/register?token=[Filtered]')
    expect(event?.breadcrumbs?.[1]?.message).toBe('no url here')
  })

  // Регрессия: крошка навигации держит URL в data.from/data.to, а не в data.url.
  // Первая версия чистила только url — токен приглашения уезжал целиком (найдено
  // прогоном реального SDK в браузере).
  it('чистит from/to у крошки навигации', () => {
    const event = scrubEvent({
      ...baseEvent(),
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/register?token=leak', to: '/register?token=leak' },
        },
      ],
    })

    expect(event?.breadcrumbs?.[0]?.data).toEqual({
      from: '/register?token=[Filtered]',
      to: '/register?token=[Filtered]',
    })
  })

  it('не ломает событие без request (ошибка cron или job)', () => {
    const event = scrubEvent({ ...baseEvent(), transaction: 'sweepDocumentExpiry' })

    expect(event?.transaction).toBe('sweepDocumentExpiry')
    expect(event?.request).toBeUndefined()
  })

  it('оставляет обычные query-параметры — по ним ищут причину', () => {
    const event = scrubEvent({
      ...baseEvent(),
      request: { url: '/api/v1/schedule?groupId=g1&week=2026-08-24' },
    })

    expect(event?.request?.url).toBe('/api/v1/schedule?groupId=g1&week=2026-08-24')
  })

  it('не пропускает секрет из-за регистра параметра', () => {
    const event = scrubEvent({ ...baseEvent(), request: { url: '/register?Token=abc' } })

    expect(event?.request?.url).toBe('/register?Token=[Filtered]')
  })
})

describe('scrubBreadcrumb', () => {
  it('маскирует токен бота Telegram в пути исходящего запроса', () => {
    const crumb = scrubBreadcrumb({
      category: 'http',
      data: { url: 'https://api.telegram.org/bot123456:AAH-secret_Token/sendMessage' },
    })

    expect(crumb?.data?.url).toBe('https://api.telegram.org/bot[token]/sendMessage')
  })

  it('убирает строку запроса и якорь, которые SDK пишет отдельными полями', () => {
    const crumb = scrubBreadcrumb({
      category: 'http',
      data: { url: 'https://minio/x', 'http.query': '?t=secret', 'http.fragment': '#a' },
    })

    expect(crumb?.data).toEqual({ url: 'https://minio/x' })
  })

  it('не пишет запросы превью ссылок: их адрес — содержимое личной переписки', () => {
    const request = {
      getHeader: (name: string) => (name === 'user-agent' ? LINK_PREVIEW_USER_AGENT : undefined),
    }

    expect(
      scrubBreadcrumb(
        { category: 'http', data: { url: 'https://private.example/x' } },
        { request },
      ),
    ).toBeNull()
  })
})

describe('scrubTransaction', () => {
  it('чистит описание и адрес HTTP-спана, SQL-спаны не трогает', () => {
    const event = scrubTransaction({
      type: 'transaction',
      spans: [
        {
          span_id: 's1',
          trace_id: 't1',
          start_timestamp: 0,
          op: 'http.client',
          description: 'POST https://api.telegram.org/bot1:abc/sendMessage',
          data: { url: 'https://api.telegram.org/bot1:abc/sendMessage', 'url.query': '?t=1' },
        },
        {
          span_id: 's2',
          trace_id: 't1',
          start_timestamp: 0,
          op: 'db',
          description: 'SELECT 1 WHERE a = ? & b = ?',
          data: {},
        },
      ],
    })

    expect(event?.spans?.[0]?.description).toBe(
      'POST https://api.telegram.org/bot[token]/sendMessage',
    )
    expect(event?.spans?.[0]?.data).toEqual({
      url: 'https://api.telegram.org/bot[token]/sendMessage',
    })
    expect(event?.spans?.[1]?.description).toBe('SELECT 1 WHERE a = ? & b = ?')
  })
})
