import { SchedulerRegistry } from '@nestjs/schedule'
import { CronMonitorService } from './cron-monitor.service'
import type { OpsNotifier } from './ops-notifier.interface'

jest.mock('./sentry', () => ({
  captureUnexpected: jest.fn(() => 'event-id-1'),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { captureUnexpected } = require('./sentry') as { captureUnexpected: jest.Mock }

describe('CronMonitorService', () => {
  // Пакет `cron` — транзитивная зависимость @nestjs/schedule, напрямую в api не объявлена,
  // поэтому в тесте описываем только то поле задачи, которое нас интересует.
  type FakeJob = { errorHandler?: (error: unknown) => void }

  const makeJob = (): FakeJob => ({})

  const registryWith = (jobs: Map<string, FakeJob>): SchedulerRegistry =>
    ({ getCronJobs: () => jobs }) as unknown as SchedulerRegistry

  const makeOps = (): OpsNotifier & { emit: jest.Mock } => ({ emit: jest.fn() })

  const monitor = (jobs: Map<string, FakeJob>, ops: OpsNotifier = makeOps()) =>
    new CronMonitorService(registryWith(jobs), ops)

  it('навешивает errorHandler на каждую зарегистрированную задачу', () => {
    const jobs = new Map<string, FakeJob>([
      ['expireInvites', makeJob()],
      ['sweepDocumentExpiry', makeJob()],
    ])

    monitor(jobs).onApplicationBootstrap()

    for (const job of jobs.values()) {
      expect(typeof job.errorHandler).toBe('function')
    }
  })

  it('падение задачи уходит в Sentry с именем задачи — раньше оно тонуло в console.error', () => {
    const job = makeJob()
    monitor(new Map([['sweepDocumentExpiry', job]])).onApplicationBootstrap()

    const error = new Error('Prisma: connection pool timeout')
    job.errorHandler?.(error)

    expect(captureUnexpected).toHaveBeenCalledWith(error, {
      source: 'cron',
      path: 'sweepDocumentExpiry',
      extra: { cronJob: 'sweepDocumentExpiry' },
    })
  })

  // T-4 (docs/TELEGRAM_BOT.md §2.2): падение cron'а обязано дойти до служебного канала —
  // до этого о нём узнавали постфактум из логов Railway.
  it('падение задачи уходит в служебный канал с именем задачи и id события Sentry', () => {
    const job = makeJob()
    const ops = makeOps()
    monitor(new Map([['publishScheduledPosts', job]]), ops).onApplicationBootstrap()

    job.errorHandler?.(new Error('Prisma: connection pool timeout\n  at foo (bar.ts:1:1)'))

    expect(ops.emit).toHaveBeenCalledWith('cronFailed', {
      job: 'publishScheduledPosts',
      error: 'Prisma: connection pool timeout',
      sentryEventId: 'event-id-1',
    })
  })

  it('сбой отправки в канал не мешает логированию и Sentry (§0.1.3)', () => {
    const job = makeJob()
    const ops: OpsNotifier = {
      emit: jest.fn(() => {
        throw new Error('канал недоступен')
      }),
    }
    monitor(new Map([['expireInvites', job]]), ops).onApplicationBootstrap()

    expect(() => job.errorHandler?.(new Error('упало'))).not.toThrow()
    expect(captureUnexpected).toHaveBeenCalled()
  })
})
