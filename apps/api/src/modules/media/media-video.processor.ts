import { Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { QUEUES } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import { MediaProcessingService } from './media-processing.service'
import { onMediaJobFailed, runMediaJob, type MediaJobData } from './media-job'

// lockDuration больше дефолтных 30 с: продление блокировки идёт по таймеру, и под полной
// загрузкой CPU перекодированием таймер может опоздать — BullMQ тогда счёл бы job
// «зависшим» и отдал второму воркеру, запустив второй ffmpeg на тот же файл.
@Processor(QUEUES.MEDIA_VIDEO, { lockDuration: 5 * 60 * 1000 })
export class MediaVideoProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaVideoProcessor.name)

  constructor(
    private readonly media: MediaProcessingService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {
    super()
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('MEDIA_VIDEO_CONCURRENCY', { infer: true })
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<JobPayload<MediaJobData>> | undefined, error: Error): Promise<void> {
    return onMediaJobFailed(this.media, this.logger, QUEUES.MEDIA_VIDEO, job, error)
  }

  process(job: Job<JobPayload<MediaJobData>>): Promise<void> {
    return runMediaJob(this.media, this.logger, job)
  }
}
