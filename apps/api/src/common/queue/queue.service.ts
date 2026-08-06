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
  ) {
    this.queues = {
      [QUEUES.EMAIL]: email,
      [QUEUES.NOTIFICATIONS]: notifications,
      [QUEUES.FILE_PROCESSING]: fileProcessing,
      [QUEUES.CLEANUP]: cleanup,
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

    const job = await this.queues[queue].add(jobName, payload, jobOptions)
    this.logger.debug(
      `enqueued ${queue}/${jobName} jobId=${job.id ?? '?'} requestId=${meta.requestId}`,
    )
  }
}
