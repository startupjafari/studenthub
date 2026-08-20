import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { captureUnexpected } from './sentry'

// Ф13.8. Библиотека `cron` при падении задачи НЕ бросает наружу: в fireOnTick она
// перехватывает reject и, если не задан errorHandler, пишет `console.error('[Cron] error
// in callback')`. Это значит, что до сих пор упавший cron не попадал ни в pino (§13),
// ни в unhandledRejection, ни, соответственно, в Sentry — задача просто не выполнялась
// молча (например, напоминания о событиях или sweep документов).
//
// Здесь на каждую зарегистрированную задачу навешивается errorHandler. Одна точка на все
// задачи вместо try/catch в семи методах CleanupService — тела задач не меняются.
//
// Хук onApplicationBootstrap выбран сознательно: @nestjs/schedule наполняет
// SchedulerRegistry в onModuleInit, а все onModuleInit гарантированно завершаются
// раньше любого onApplicationBootstrap — к этому моменту список задач полон.
@Injectable()
export class CronMonitorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronMonitorService.name)

  constructor(private readonly scheduler: SchedulerRegistry) {}

  onApplicationBootstrap(): void {
    const jobs = this.scheduler.getCronJobs()
    for (const [name, job] of jobs) {
      job.errorHandler = (error: unknown): void => this.report(name, error)
    }
    this.logger.log(`Мониторинг cron-задач включён: ${jobs.size}`)
  }

  private report(name: string, error: unknown): void {
    const eventId = captureUnexpected(error, {
      source: 'cron',
      path: name,
      extra: { cronJob: name },
    })
    this.logger.error(
      { err: error, cronJob: name, ...(eventId ? { sentryEventId: eventId } : {}) },
      `Cron-задача ${name} упала`,
    )
  }
}
