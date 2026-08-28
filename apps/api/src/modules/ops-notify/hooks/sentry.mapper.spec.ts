import { mapSentryHook } from './sentry.mapper'

// docs/TELEGRAM_BOT.md §7.5. Payload — форма вебхука Sentry об issue, урезанная до
// читаемых полей. Проверяем в том числе то, чего в сообщении быть НЕ должно (§0.1.1).

const payload = {
  action: 'created',
  data: {
    issue: {
      id: '4507',
      title: 'PrismaClientKnownRequestError: Timed out fetching a connection',
      count: '37',
      web_url: 'https://sentry.io/organizations/sh/issues/4507/',
      metadata: { type: 'PrismaClientKnownRequestError' },
    },
  },
}

describe('mapSentryHook', () => {
  it('новая группа ошибок — заголовок, счётчик и ссылка', () => {
    expect(mapSentryHook(payload)).toEqual({
      event: 'sentryIssue',
      data: {
        issueId: '4507',
        title: 'PrismaClientKnownRequestError: Timed out fetching a connection',
        count: '37',
        issueUrl: 'https://sentry.io/organizations/sh/issues/4507/',
      },
    })
  })

  it('возврат ошибки после закрытия — тоже событие', () => {
    expect(mapSentryHook({ ...payload, action: 'regression' })?.event).toBe('sentryIssue')
  })

  it('работа в трекере в канал не идёт: resolved, assigned, ignored', () => {
    for (const action of ['resolved', 'assigned', 'ignored']) {
      expect(mapSentryHook({ ...payload, action })).toBeNull()
    }
  })

  it('берёт ровно три поля — стектрейсы и контекст запроса наружу не уезжают', () => {
    const withExtras = {
      action: 'created',
      data: {
        issue: {
          id: '1',
          title: 'Error',
          culprit: 'POST /api/v1/documents',
          firstSeen: '2026-08-28T10:00:00Z',
          assignedTo: { email: 'dev@studenthub.app' },
        },
      },
    }

    expect(Object.keys(mapSentryHook(withExtras)?.data ?? {}).sort()).toEqual(['issueId', 'title'])
  })

  it('старый формат со ссылкой в permalink тоже читается', () => {
    const legacy = { issue: { id: '9', title: 'Error', permalink: 'https://sentry.io/i/9' } }

    expect(mapSentryHook(legacy)?.data.issueUrl).toBe('https://sentry.io/i/9')
  })

  it('мусор вместо payload не роняет приём вебхука', () => {
    expect(mapSentryHook({})).toBeNull()
    expect(mapSentryHook({ action: 'created', data: {} })).toBeNull()
    expect(mapSentryHook({ action: 'created', data: { issue: {} } })).toBeNull()
  })
})
