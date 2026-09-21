import { SchedulerRegistry } from '@nestjs/schedule'
import { CronMonitorService } from './cron-monitor.service'

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

  const monitor = (jobs: Map<string, FakeJob>) => new CronMonitorService(registryWith(jobs))

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
})
