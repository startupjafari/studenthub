import { Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { reportJobFailure } from '../../common/monitoring'
import { EMAIL_JOBS, QUEUES } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import { MailerService } from './mailer.service'
import {
  renderApplicationStatus,
  renderCompanyVerification,
  renderEventReminder,
  renderInvite,
  renderNotification,
  renderScheduleChange,
  renderWelcome,
  type ApplicationStatusPayload,
  type CompanyVerificationPayload,
  type EventReminderPayload,
  type InvitePayload,
  type NotificationPayload,
  type RenderedEmail,
  type ScheduleChangePayload,
  type WelcomePayload,
} from './templates'

// Воркер очереди `email`: рендерит шаблон по имени job'а и отправляет письмо.
// Идемпотентность отправки обеспечивается детерминированным jobId на стороне продюсера
// (BullMQ отбрасывает дубликат) — сам процессор писем не хранит состояние.
@Processor(QUEUES.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name)

  constructor(private readonly mailer: MailerService) {
    super()
  }

  // Ф13.8: исчерпавший попытки job больше не пропадает молча — лог + Sentry.
  // `job.data` в трекер не уходит (в payload'ах — получатели и тексты, §11.3).
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(this.logger, QUEUES.EMAIL, job, error)
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const { _meta, ...data } = job.data
    const requestId = _meta?.requestId

    const rendered = this.render(job.name, data)
    if (!rendered) {
      // Пробрасываем: неизвестный job не должен молча считаться успешным (BACKEND_RULES §9.2).
      throw new Error(`Неизвестный email job: ${job.name}`)
    }

    const to = (data as { to?: string }).to
    if (!to) {
      throw new Error(`email job ${job.name} без получателя (jobId=${job.id ?? '?'})`)
    }

    await this.mailer.send({ to, ...rendered })
    this.logger.log(
      `Отправлено письмо ${job.name} → ${to} (jobId=${job.id ?? '?'}, requestId=${requestId ?? '-'})`,
    )
  }

  private render(name: string, data: Record<string, unknown>): RenderedEmail | null {
    switch (name) {
      case EMAIL_JOBS.SEND_INVITE:
        return renderInvite(data as unknown as InvitePayload)
      case EMAIL_JOBS.SEND_WELCOME:
        return renderWelcome(data as unknown as WelcomePayload)
      case EMAIL_JOBS.SEND_APPLICATION_STATUS:
        return renderApplicationStatus(data as unknown as ApplicationStatusPayload)
      case EMAIL_JOBS.SEND_SCHEDULE_CHANGE:
        return renderScheduleChange(data as unknown as ScheduleChangePayload)
      case EMAIL_JOBS.SEND_EVENT_REMINDER:
        return renderEventReminder(data as unknown as EventReminderPayload)
      case EMAIL_JOBS.SEND_NOTIFICATION:
        return renderNotification(data as unknown as NotificationPayload)
      case EMAIL_JOBS.SEND_COMPANY_VERIFICATION:
        return renderCompanyVerification(data as unknown as CompanyVerificationPayload)
      default:
        return null
    }
  }
}
