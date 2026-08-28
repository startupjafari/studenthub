import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import type { JobsOptions, Queue } from 'bullmq'
import { QUEUES, type QueueName } from './queue.constants'

// Метаданные, вкладываемые в payload каждого job'а. requestId позволяет связать
// асинхронную обработку с исходным HTTP-запросом в логах (docs/BACKEND_RULES.md §9.2).
export interface JobMeta {
  requestId: string
  enqueuedAt: string
}

// Payload job'а = данные + служебные _meta. Процессоры читают _meta для логирования.
export type JobPayload<T extends object = Record<string, unknown>> = T & { _meta: JobMeta }

/** Агрегаты по очереди для служебных проверок. */
export interface QueueCounts {
  waiting: number
  active: number
  delayed: number
  failed: number
}

export interface EnqueueOptions extends JobsOptions {
  // Сквозной идентификатор запроса; если не передан — генерируем, чтобы job всегда был трассируем.
  requestId?: string
}

// Единая точка постановки задач: проставляет базовую конфигурацию (наследуется из
// defaultJobOptions модуля), штампует _meta и логирует постановку с requestId.
// Payload — только идентификаторы; целые сущности передавать запрещено (docs/BACKEND_RULES.md §9.2).
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name)
  private readonly queues: Record<QueueName, Queue>

  constructor(
    @InjectQueue(QUEUES.EMAIL) email: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) notifications: Queue,
    @InjectQueue(QUEUES.FILE_PROCESSING) fileProcessing: Queue,
    @InjectQueue(QUEUES.CLEANUP) cleanup: Queue,
    @InjectQueue(QUEUES.LINK_PREVIEW) linkPreview: Queue,
    @InjectQueue(QUEUES.OPS_NOTIFY) opsNotify: Queue,
  ) {
    this.queues = {
      [QUEUES.EMAIL]: email,
      [QUEUES.NOTIFICATIONS]: notifications,
      [QUEUES.FILE_PROCESSING]: fileProcessing,
      [QUEUES.CLEANUP]: cleanup,
      [QUEUES.LINK_PREVIEW]: linkPreview,
      [QUEUES.OPS_NOTIFY]: opsNotify,
    }
  }

  /**
   * Ставит job в очередь. Для идемпотентности передавайте детерминированный `jobId`
   * в опциях — BullMQ отбросит дубликат с тем же id.
   */
  async enqueue<T extends object>(
    queue: QueueName,
    jobName: string,
    data: T,
    opts: EnqueueOptions = {},
  ): Promise<void> {
    const { requestId, ...jobOptions } = opts
    const meta: JobMeta = {
      requestId: requestId ?? randomUUID(),
      enqueuedAt: new Date().toISOString(),
    }
    const payload: JobPayload<T> = { ...data, _meta: meta }

    // BullMQ разрешает ':' в jobId лишь для 3-частных легаси-id; наши ключи идемпотентности
    // (например `new-message:{id}`) содержат ':' произвольно — заменяем на '_', чтобы add не падал.
    if (typeof jobOptions.jobId === 'string' && jobOptions.jobId.includes(':')) {
      jobOptions.jobId = jobOptions.jobId.replace(/:/g, '_')
    }

    // Постановка job — сайд-эффект (email/уведомление/обработка файла). BullMQ-соединение
    // требует maxRetriesPerRequest:null, поэтому при недоступном Redis `add()` висит в
    // offline-очереди и заблокировал бы HTTP-запрос, чей основной эффект в БД уже закоммичен.
    // Ограничиваем ожидание таймаутом и НЕ пробрасываем ошибку: пользовательское действие
    // всегда завершается, доставка сайд-эффекта деградирует до best-effort (docs §10, §12).
    try {
      const job = await this.withTimeout(
        this.queues[queue].add(jobName, payload, jobOptions),
        ENQUEUE_TIMEOUT_MS,
      )
      this.logger.debug(
        `enqueued ${queue}/${jobName} jobId=${job.id ?? '?'} requestId=${meta.requestId}`,
      )
    } catch (error) {
      this.logger.error(
        { err: error, queue, jobName, requestId: meta.requestId },
        `Не удалось поставить job ${queue}/${jobName} (Redis недоступен?) — сайд-эффект пропущен`,
      )
    }
  }

  /**
   * Глубина очереди — для служебных проверок (docs/TELEGRAM_BOT.md §2.2, T-5).
   *
   * Живёт здесь, а не в модуле наблюдения: очереди — зона ответственности этого сервиса,
   * и второй источник тех же чисел разошёлся бы с первым. Только чтение агрегатов, без
   * выгрузки job'ов в приложение (§7.4.4).
   */
  async counts(queue: QueueName): Promise<QueueCounts> {
    const counts = await this.queues[queue].getJobCounts('waiting', 'active', 'delayed', 'failed')
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    }
  }

  /**
   * Причина последнего падения в очереди — она отвечает на «что чинить», тогда как счётчик
   * failed отвечает только на «что-то сломалось». Берём ровно один job (`0..0`, новые
   * первыми) — читать всю пачку упавших ради текста ошибки незачем.
   */
  async lastFailedReason(queue: QueueName): Promise<string | null> {
    const [job] = await this.queues[queue].getJobs(['failed'], 0, 0, false)
    return job?.failedReason ?? null
  }

  // Ограничивает ожидание постановки: если Redis висит, отклоняемся через ENQUEUE_TIMEOUT_MS.
  // Базовый add() при этом может позже завершиться после reconnect — это допустимо.
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`enqueue timeout ${ms}ms`)), ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
}

const ENQUEUE_TIMEOUT_MS = 3000
