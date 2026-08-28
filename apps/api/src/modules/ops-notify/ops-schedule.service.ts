import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectQueue } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'
import { OPS_JOBS, QUEUES } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'

// Расписание служебных проверок (docs/TELEGRAM_BOT.md §7.4.3).
//
// Repeatable job'ы BullMQ, а не `@Cron`, по двум причинам сразу:
//   • «одна реплика — одна проверка»: расписание живёт в общем Redis, и три сообщения об
//     одном инциденте с трёх инстансов невозможны по устройству, а не по договорённости;
//   • `BACKEND_RULES §9.3` держит все `@Cron` в `CleanupService`, и тащить туда проверки
//     служебного канала значило бы размазать модуль по чужому.
//
// Планировщик заводится только вместе с включённым модулем — нет токена, нет и таймеров.

/** Молчание частой задачи ловим на её же масштабе: раз в минуту. */
const CRON_SILENCE_EVERY_MS = 60_000

/** Очереди, зависимости и внешний адрес меняются медленнее — раз в пять минут (§2.2). */
const SLOW_CHECK_EVERY_MS = 5 * 60_000

@Injectable()
export class OpsScheduleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OpsScheduleService.name)

  constructor(
    @InjectQueue(QUEUES.OPS_NOTIFY) private readonly queue: Queue,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const schedules: { id: string; job: string; everyMs: number }[] = [
      {
        id: OPS_JOBS.CHECK_CRON_SILENCE,
        job: OPS_JOBS.CHECK_CRON_SILENCE,
        everyMs: CRON_SILENCE_EVERY_MS,
      },
      { id: OPS_JOBS.CHECK_QUEUES, job: OPS_JOBS.CHECK_QUEUES, everyMs: SLOW_CHECK_EVERY_MS },
      {
        id: OPS_JOBS.CHECK_DEPENDENCIES,
        job: OPS_JOBS.CHECK_DEPENDENCIES,
        everyMs: SLOW_CHECK_EVERY_MS,
      },
      {
        id: OPS_JOBS.CHECK_PINNED_STATUS,
        job: OPS_JOBS.CHECK_PINNED_STATUS,
        everyMs: SLOW_CHECK_EVERY_MS,
      },
      { id: OPS_JOBS.CHECK_SECURITY, job: OPS_JOBS.CHECK_SECURITY, everyMs: SLOW_CHECK_EVERY_MS },
      // Дрейф веток — тренд, а не авария: раз в сутки достаточно.
      {
        id: OPS_JOBS.CHECK_BRANCH_DRIFT,
        job: OPS_JOBS.CHECK_BRANCH_DRIFT,
        everyMs: 24 * 60 * 60_000,
      },
    ]

    // Сводка — единственная проверка по времени суток, а не по интервалу: «21:00 по
    // таймзоне университета» интервалом не выражается (§2.3).
    try {
      await this.queue.upsertJobScheduler(
        OPS_JOBS.CHECK_DIGEST,
        {
          pattern: this.config.get('OPS_DIGEST_CRON', { infer: true }),
          tz: this.config.get('OPS_DIGEST_TZ', { infer: true }),
        },
        { name: OPS_JOBS.CHECK_DIGEST },
      )
    } catch (error) {
      this.logger.warn(`Не удалось завести вечернюю сводку: ${String(error)}`)
    }

    // Пинг заводим только при заданном адресе: пустая проверка каждые пять минут — это
    // строчка в логе, которая ничего не проверяет, и повод думать, что наблюдение есть.
    if (this.config.get('OPS_PUBLIC_URL', { infer: true })) {
      schedules.push({
        id: OPS_JOBS.CHECK_PUBLIC_PING,
        job: OPS_JOBS.CHECK_PUBLIC_PING,
        everyMs: SLOW_CHECK_EVERY_MS,
      })
    } else {
      await this.remove(OPS_JOBS.CHECK_PUBLIC_PING)
    }

    for (const { id, job, everyMs } of schedules) {
      try {
        // upsert, а не add: при рестарте и при смене интервала расписание переписывается,
        // а не удваивается.
        await this.queue.upsertJobScheduler(id, { every: everyMs }, { name: job })
      } catch (error) {
        // Недоступный Redis не должен мешать старту: наблюдение деградирует, приложение живёт.
        this.logger.warn(`Не удалось завести проверку ${id}: ${String(error)}`)
        return
      }
    }
    this.logger.log(`Служебные проверки заведены: ${schedules.length}`)
  }

  /** Снимает расписание, которое перестало быть нужным (например, убрали OPS_PUBLIC_URL). */
  private async remove(id: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(id)
    } catch {
      // Расписания могло не быть вовсе — это норма, а не ошибка.
    }
  }
}
