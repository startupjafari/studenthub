import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { QUEUES, QueueService, type QueueName } from '../../../common/queue'
import { OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'
import { REDIS_CLIENT } from '../../../common/redis/redis.constants'
import type { EnvVars } from '../../../config/env.schema'
import { OpsStatusService } from '../ops-status.service'

// T-5 (docs/TELEGRAM_BOT.md §2.2): глубина очередей и рост `failed` с текстом последней
// ошибки. Счётчик `failed` отвечает на «что-то сломалось», текст ошибки — на «что чинить»,
// поэтому в сообщении есть оба.
//
// Глубина очередей берётся из `OpsStatusService` — единственного источника метрик (§7.1.5);
// текст последней ошибки — из `QueueService`, владельца очередей. Своих подключений
// к очередям модуль наблюдения не заводит.

/**
 * Порог считаем по РОСТУ, а не по абсолютному числу: упавшие job'ы хранятся намеренно
 * (`removeOnFail: false`), и накопленная за месяц сотня — не новость, а тридцать новых
 * за пять минут — новость.
 *
 * База роста лежит в Redis, а не в памяти процесса: проверку выполняет та реплика, которая
 * первой взяла job, и в памяти каждая копила бы свою базу — рост считался бы от чужого
 * замера. TTL страхует от базы, устаревшей настолько, что «рост» перестал что-либо значить.
 */
const BASELINE_PREFIX = 'ops:queue:failed:'
const BASELINE_TTL_SEC = 60 * 60

@Injectable()
export class QueuesCheck {
  private readonly logger = new Logger(QueuesCheck.name)

  constructor(
    private readonly status: OpsStatusService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async run(): Promise<void> {
    const waitingThreshold = this.config.get('OPS_QUEUE_WAITING_THRESHOLD', { infer: true })
    const failedThreshold = this.config.get('OPS_QUEUE_FAILED_THRESHOLD', { infer: true })

    for (const counts of await this.status.queues()) {
      // Собственную очередь не проверяем: сообщение о её заторе пришлось бы слать через неё же.
      if (counts.name === QUEUES.OPS_NOTIFY) continue
      try {
        await this.checkQueue(counts, waitingThreshold, failedThreshold)
      } catch (error) {
        // Каждая очередь падает независимо — недоступность одной не должна скрыть остальные.
        this.logger.warn(`Не удалось оценить очередь ${counts.name}: ${String(error)}`)
      }
    }
  }

  private async checkQueue(
    counts: { name: QueueName; waiting: number; failed: number },
    waitingThreshold: number,
    failedThreshold: number,
  ): Promise<void> {
    const name = counts.name

    if (counts.waiting >= waitingThreshold) {
      this.notifier.emit('queueBacklog', { queue: name, waiting: counts.waiting })
    }

    const key = `${BASELINE_PREFIX}${name}`
    const previous = await this.redis.get(key)
    await this.redis.set(key, String(counts.failed), 'EX', BASELINE_TTL_SEC)
    // Первая проверка (или база протухла) задаёт точку отсчёта и молчит: иначе при каждом
    // рестарте канал получал бы «рост» размером со всю историю падений.
    if (previous === null) return

    const growth = counts.failed - Number(previous)
    if (growth < failedThreshold) return

    this.notifier.emit('queueFailing', {
      queue: name,
      failed: `+${growth} (всего ${counts.failed})`,
      // Текст ошибки санитайзится на выходе, но в нём могут быть адреса получателей —
      // поэтому берём только первую строку: стектрейс в канале не нужен, он есть в Sentry.
      lastError: (await this.queue.lastFailedReason(name))?.split('\n')[0] ?? '—',
    })
  }
}
