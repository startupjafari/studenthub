import { ArgumentsHost, HttpStatus } from '@nestjs/common'
import type { PinoLogger } from 'nestjs-pino'
import { AppException } from '../exceptions/app.exception'
import { HttpExceptionFilter } from './http-exception.filter'
import type { HttpStatusCounter } from '../monitoring/http-status.counter'

jest.mock('../monitoring/sentry', () => ({
  captureException: jest.fn(() => 'event-id-1'),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { captureException } = require('../monitoring/sentry') as { captureException: jest.Mock }

// Порог отправки в Sentry (Ф13.8) — тот же, что у лога уровня error: 5xx = наш баг.
// Если этот тест «починить» ослаблением, issue-лента утонет в 401/403/404.
describe('HttpExceptionFilter — отправка в Sentry', () => {
  const logger = { error: jest.fn() } as unknown as PinoLogger
  const send = jest.fn()
  const status = jest.fn(() => ({ send }))

  const hostWith = (user?: { sub: string }): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'req-1',
          url: '/api/v1/posts?limit=20',
          method: 'POST',
          ...(user ? { user } : {}),
        }),
        getResponse: () => ({ status }),
      }),
    }) as unknown as ArgumentsHost

  // Счётчик ответов (docs/TELEGRAM_BOT.md §2.3) — сайд-эффект на пути ответа, поэтому
  // в тесте он просто мок: важно, что фильтр его зовёт и не ждёт.
  const statusCounter = { record: jest.fn() }
  const filter = new HttpExceptionFilter(logger, statusCounter as unknown as HttpStatusCounter)

  it('неожиданная ошибка (500) уходит в трекер с requestId и id пользователя', () => {
    filter.catch(new TypeError('cannot read property of undefined'), hostWith({ sub: 'u-1' }))

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0][1]).toEqual({
      source: 'http',
      requestId: 'req-1',
      userId: 'u-1',
      path: '/api/v1/posts?limit=20',
      method: 'POST',
      code: 'INTERNAL_ERROR',
    })
  })

  it('штатный отказ 403 в трекер не идёт', () => {
    filter.catch(new AppException('FORBIDDEN', 'Нет прав'), hostWith({ sub: 'u-1' }))

    expect(captureException).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN)
  })

  it('id события Sentry попадает в лог — из строки pino можно перейти в issue', () => {
    filter.catch(new Error('boom'), hostWith())

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sentryEventId: 'event-id-1' }),
      'Необработанное исключение',
    )
  })

  it('работает для анонимного запроса (пользователя в request ещё нет)', () => {
    filter.catch(new Error('boom'), hostWith())

    expect(captureException.mock.calls[0][1]).toMatchObject({ userId: undefined })
  })
})
