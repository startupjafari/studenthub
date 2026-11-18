import { Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { reportJobFailure } from '../../common/monitoring'
import { MEDIA_JOBS, QUEUES } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import { MediaProcessingService } from './media-processing.service'
import { onMediaJobFailed, runMediaJob, type MediaJobData } from './media-job'
import { StickerProcessingService, type StickerJobData } from './sticker-processing.service'

// lockDuration больше дефолтных 30 с: продление блокировки идёт по таймеру, и под полной
// загрузкой CPU перекодированием таймер может опоздать — BullMQ тогда счёл бы job
// «зависшим» и отдал второму воркеру, запустив второй ffmpeg на тот же файл.
@Processor(QUEUES.MEDIA_VIDEO, { lockDuration: 5 * 60 * 1000 })
export class MediaVideoProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaVideoProcessor.name)

  constructor(
    private readonly media: MediaProcessingService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly stickers: StickerProcessingService,
  ) {
    super()
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('MEDIA_VIDEO_CONCURRENCY', { infer: true })
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<JobPayload<MediaJobData>> | undefined, error: Error): Promise<void> {
    // Стикер своего набора (MEDIA_JOBS.STICKER): исчерпаны попытки — стикер FAILED, а
    // временные объекты убираются, вместо отметки «оригинал» у файла.
    if (job?.name === MEDIA_JOBS.STICKER) {
      reportJobFailure(this.logger, QUEUES.MEDIA_VIDEO, job, error)
      if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
        const data = job.data as unknown as StickerJobData
        await this.stickers.markFailed(data.stickerId).catch(() => undefined)
        await this.stickers.cleanup(data).catch(() => undefined)
      }
      return
    }
    return onMediaJobFailed(this.media, this.logger, QUEUES.MEDIA_VIDEO, job, error)
  }

  process(job: Job<JobPayload<MediaJobData>>): Promise<void> {
    if (job.name === MEDIA_JOBS.STICKER) {
      return this.stickers.build(job.data as unknown as StickerJobData)
    }
    return runMediaJob(this.media, this.logger, job)
  }
}
