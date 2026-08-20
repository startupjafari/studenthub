import { Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { reportJobFailure } from '../../common/monitoring'
import { FILE_JOBS, QUEUES } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import { UserService } from './users.service'

interface GenerateThumbnailData {
  fileId: string
  bucket: string
  key: string
  userId: string
}

// Воркер очереди `file-processing`: пока обслуживает только генерацию превью аватара.
// Идемпотентность — по jobId `thumb_<fileId>` на стороне продюсера (setAvatar).
@Processor(QUEUES.FILE_PROCESSING)
export class AvatarThumbnailProcessor extends WorkerHost {
  private readonly logger = new Logger(AvatarThumbnailProcessor.name)

  constructor(private readonly users: UserService) {
    super()
  }

  // Ф13.8: исчерпавший попытки job больше не пропадает молча — лог + Sentry.
  // `job.data` в трекер не уходит (в payload'ах — получатели и тексты, §11.3).
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(this.logger, QUEUES.FILE_PROCESSING, job, error)
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const { _meta, ...data } = job.data
    const requestId = _meta?.requestId

    switch (job.name) {
      case FILE_JOBS.GENERATE_THUMBNAIL:
        await this.users.generateAvatarThumbnail(data as unknown as GenerateThumbnailData)
        this.logger.log(
          `Сгенерировано превью аватара (jobId=${job.id ?? '?'}, requestId=${requestId ?? '-'})`,
        )
        return
      default:
        // Пробрасываем: неизвестный job не должен молча считаться успешным (BACKEND_RULES §9.2).
        throw new Error(`Неизвестный file-processing job: ${job.name}`)
    }
  }
}
