import { HttpStatus, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { AppException } from '../exceptions/app.exception'
import { captureException, captureUnexpected, isExpectedBusinessError } from './sentry'
import { reportJobFailure } from './job-failure'

// Мокаем SDK: тесты проверяют, ЧТО мы отправляем (теги, отсутствие персональных данных),
// а не работу самого Sentry. Реальных сетевых обращений в тестах быть не должно.
const scope = {
  setTag: jest.fn(),
  setUser: jest.fn(),
  setExtra: jest.fn(),
}

jest.mock('@sentry/nestjs', () => ({
  withScope: (fn: (s: typeof scope) => string) => fn(scope),
  captureException: jest.fn(() => 'event-id-1'),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require('@sentry/nestjs') as { captureException: jest.Mock }

describe('captureException', () => {
  beforeEach(() => {
    scope.setTag.mockClear()
    scope.setUser.mockClear()
    scope.setExtra.mockClear()
  })

  it('проставляет теги для склейки с логами pino', () => {
    const eventId = captureException(new Error('boom'), {
      source: 'http',
      requestId: 'req-42',
      path: '/api/v1/posts',
      method: 'POST',
      code: 'INTERNAL_ERROR',
    })

    expect(eventId).toBe('event-id-1')
    expect(scope.setTag).toHaveBeenCalledWith('source', 'http')
    expect(scope.setTag).toHaveBeenCalledWith('request_id', 'req-42')
    expect(scope.setTag).toHaveBeenCalledWith('error_code', 'INTERNAL_ERROR')
    expect(scope.setTag).toHaveBeenCalledWith('path', '/api/v1/posts')
  })

  it('отправляет только id пользователя — без email и ФИО (§11.3)', () => {
    captureException(new Error('boom'), { source: 'http', userId: 'user-uuid' })

    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-uuid' })
    expect(scope.setUser).toHaveBeenCalledTimes(1)
    const [[user]] = scope.setUser.mock.calls as [[Record<string, unknown>]]
    expect(Object.keys(user)).toEqual(['id'])
  })

  it('вычищает секрет из пути перед отправкой', () => {
    captureException(new Error('boom'), { source: 'http', path: '/register?token=abc' })

    expect(scope.setTag).toHaveBeenCalledWith('path', '/register?token=[Filtered]')
  })

  it('не создаёт extra для undefined-значений', () => {
    captureException(new Error('boom'), {
      source: 'queue',
      extra: { queue: 'email', attemptsMade: undefined },
    })

    expect(scope.setExtra).toHaveBeenCalledWith('queue', 'email')
    expect(scope.setExtra).toHaveBeenCalledTimes(1)
  })
})

describe('isExpectedBusinessError', () => {
  it('4xx AppException — штатный отказ, в трекер не идёт', () => {
    // Статус берётся из реестра ERROR_CODE_STATUS по коду (§4.3).
    const forbidden = new AppException('FORBIDDEN', 'Нет прав')
    expect(forbidden.getStatus()).toBe(HttpStatus.FORBIDDEN)

    expect(isExpectedBusinessError(forbidden)).toBe(true)
    expect(captureUnexpected(forbidden, { source: 'ws' })).toBeUndefined()
  })

  it('5xx AppException — наш баг, отправляем (декоратор Sentry этот случай пропускает)', () => {
    const failure = new AppException('INTERNAL_ERROR', 'Сбой')
    expect(failure.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)

    expect(isExpectedBusinessError(failure)).toBe(false)
    expect(captureUnexpected(failure, { source: 'ws' })).toBe('event-id-1')
  })

  it('произвольная ошибка (TypeError, сбой Prisma) отправляется', () => {
    expect(isExpectedBusinessError(new TypeError('undefined is not a function'))).toBe(false)
  })
})

describe('reportJobFailure', () => {
  it('не отправляет job.data — там получатели и тексты уведомлений', () => {
    const logger = { error: jest.fn() } as unknown as Logger
    const job = {
      name: 'send-notification',
      id: '42',
      attemptsMade: 3,
      data: { _meta: { requestId: 'req-7' }, to: 'student@example.kz', body: 'Оценка 4' },
    } as unknown as Job<{ _meta?: { requestId?: string } }>

    reportJobFailure(logger, 'email', job, new Error('SMTP timeout'))

    const payload = JSON.stringify(Sentry.captureException.mock.calls)
    expect(payload).not.toContain('student@example.kz')
    expect(payload).not.toContain('Оценка 4')
    expect(scope.setExtra).toHaveBeenCalledWith('jobName', 'send-notification')
    expect(scope.setTag).toHaveBeenCalledWith('request_id', 'req-7')
  })

  it('переживает падение без job (воркер упал до выдачи задачи)', () => {
    const logger = { error: jest.fn() } as unknown as Logger

    expect(() =>
      reportJobFailure(logger, 'email', undefined, new Error('Redis недоступен')),
    ).not.toThrow()
    expect(logger.error).toHaveBeenCalled()
  })
})
