import { Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { QUEUES } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import { MediaProcessingService } from './media-processing.service'
import { onMediaJobFailed, runMediaJob, type MediaJobData } from './media-job'

@Processor(QUEUES.MEDIA_IMAGE)
export class MediaImageProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaImageProcessor.name)

  constructor(
    private readonly media: MediaProcessingService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {
    super()
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('MEDIA_IMAGE_CONCURRENCY', { infer: true })
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<JobPayload<MediaJobData>> | undefined, error: Error): Promise<void> {
    return onMediaJobFailed(this.media, this.logger, QUEUES.MEDIA_IMAGE, job, error)
  }

  process(job: Job<JobPayload<MediaJobData>>): Promise<void> {
    return runMediaJob(this.media, this.logger, job)
  }
}
