import { Inject, Injectable, Logger } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'
import { OpsPolicyService } from '../ops-policy.service'

// T-5 (docs/TELEGRAM_BOT.md §2.2): «`publishScheduledPosts` крутится раз в минуту, и её
// тишина десять минут такой же инцидент, как исключение, хотя ошибки не было».
//
// Проверка НЕ знает имён задач и их расписаний: период каждой вычисляется из неё самой
// (два ближайших срабатывания), поэтому новая cron-задача попадает под наблюдение сама,
// а модуль не обзаводится знанием о предметной области (§7.3.6).
//
// Ограничение, которое стоит помнить: `lastExecution` — состояние процесса. Проверка видит
// планировщик той реплики, в которой выполняется job. Молчание планировщика в соседней
// реплике она не поймает; это компромисс в пользу простоты — общий Redis-heartbeat на
// каждый тик стоил бы записи в Redis раз в минуту с каждой задачи каждой реплики.

/** Наблюдаем только частые задачи: у недельной чистки «два окна» — это две недели. */
const WATCHED_PERIOD_MAX_MS = 15 * 60 * 1000

/** Запас на дрожание таймера и время самой задачи, чтобы не ловить ложные срабатывания. */
const SLACK_MS = 30_000

@Injectable()
export class CronSilenceCheck {
  private readonly logger = new Logger(CronSilenceCheck.name)
  private readonly startedAt = Date.now()

  constructor(
    private readonly scheduler: SchedulerRegistry,
    private readonly policy: OpsPolicyService,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async run(): Promise<void> {
    const now = Date.now()

    for (const [name, job] of this.scheduler.getCronJobs()) {
      const period = this.periodMs(job)
      if (period === null || period > WATCHED_PERIOD_MAX_MS) continue

      // Пока приложение не прожило два окна, судить не о чем: задача просто ещё не наступала.
      const lastRun = job.lastExecution?.getTime() ?? job.lastDate()?.getTime() ?? this.startedAt
      const deadline = 2 * period + SLACK_MS
      if (now - this.startedAt < deadline) continue

      const silent = now - lastRun > deadline
      // Гистерезис не нужен: «пропущено два окна подряд» — он и есть.
      if (!(await this.policy.transitioned(`cron:${name}`, silent ? 'silent' : 'ok', 'ok', 1))) {
        continue
      }

      if (silent) {
        this.notifier.emit('cronSilent', {
          job: name,
          lastRun: new Date(lastRun).toISOString(),
          period: `${Math.round(period / 1000)} с`,
        })
        this.logger.warn(`Cron-задача ${name} не срабатывала с ${new Date(lastRun).toISOString()}`)
      } else {
        this.notifier.emit('cronResumed', { job: name })
      }
    }
  }

  /**
   * Период задачи как расстояние между двумя ближайшими срабатываниями. Разбирать
   * cron-выражение самостоятельно не нужно и вредно: у планировщика уже есть ответ.
   */
  private periodMs(job: { nextDates(count: number): { toMillis(): number }[] }): number | null {
    try {
      const [first, second] = job.nextDates(2)
      if (!first || !second) return null
      return second.toMillis() - first.toMillis()
    } catch {
      // Задача остановлена или расписание нестандартное — не наш случай.
      return null
    }
  }
}
