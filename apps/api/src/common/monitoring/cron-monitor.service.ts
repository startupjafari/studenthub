import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { captureUnexpected } from './sentry'
import { OPS_NOTIFIER, type OpsNotifier } from './ops-notifier.interface'

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

  // Зависимость от ПОРТА, не от Telegram (docs/TELEGRAM_BOT.md §4.1): этот класс не знает
  // и не должен знать, куда уходит сообщение. Без настроенного бота внедряется заглушка.
  constructor(
    private readonly scheduler: SchedulerRegistry,
    @Inject(OPS_NOTIFIER) private readonly ops: OpsNotifier,
  ) {}

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

    // T-4: в канал уходит имя задачи и id события Sentry — по ним разбор начинается сразу.
    // Текст ошибки берём первой строкой: стектрейс есть в трекере, в чате он только мешает
    // и повышает шанс вынести наружу лишнее. Повтор в пределах 10 минут схлопывает реестр.
    // Порт по контракту не бросает, но этот метод — errorHandler cron-задачи: исключение
    // отсюда всплыло бы в библиотеку `cron` и осталось бы без обработчика вовсе.
    try {
      this.ops.emit('cronFailed', {
        job: name,
        error: this.shortMessage(error),
        ...(eventId ? { sentryEventId: eventId } : {}),
      })
    } catch (opsError) {
      this.logger.warn(
        `Не удалось сообщить о падении ${name} в служебный канал: ${String(opsError)}`,
      )
    }
  }

  private shortMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.split('\n')[0]?.slice(0, 200) ?? 'без описания'
  }
}
