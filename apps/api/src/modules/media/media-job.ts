import type { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { reportJobFailure } from '../../common/monitoring'
import { MEDIA_JOBS } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import type { MediaProcessingService } from './media-processing.service'

export interface MediaJobData {
  fileId: string
  sourceId?: string
}

// Общий разбор job'а для обеих очередей: различаются они конкурентностью и временем
// блокировки, а не логикой.
export async function runMediaJob(
  media: MediaProcessingService,
  logger: Logger,
  job: Job<JobPayload<MediaJobData>>,
): Promise<void> {
  const { fileId, sourceId } = job.data
  const started = Date.now()
  switch (job.name) {
    case MEDIA_JOBS.PROCESS:
      await media.process(fileId)
      break
    case MEDIA_JOBS.COPY:
      if (!sourceId) throw new Error(`copy-media-variants без sourceId (jobId=${job.id ?? '?'})`)
      await media.copy(sourceId, fileId)
      break
    default:
      // Пробрасываем: неизвестный job не должен молча считаться успешным (BACKEND_RULES §9.2).
      throw new Error(`Неизвестный media job: ${job.name}`)
  }
  logger.log(
    `${job.name} ${fileId} за ${Date.now() - started} мс (jobId=${job.id ?? '?'}, requestId=${job.data._meta?.requestId ?? '-'})`,
  )
}

// Последняя попытка исчерпана — файл показывается оригиналом, а не висит «в обработке».
export async function onMediaJobFailed(
  media: MediaProcessingService,
  logger: Logger,
  queue: string,
  job: Job<JobPayload<MediaJobData>> | undefined,
  error: Error,
): Promise<void> {
  reportJobFailure(logger, queue, job, error)
  if (!job) return
  const attempts = job.opts.attempts ?? 1
  if (job.attemptsMade >= attempts) await media.markFailed(job.data.fileId).catch(() => undefined)
}
