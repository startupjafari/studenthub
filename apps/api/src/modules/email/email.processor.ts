import { Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { UnrecoverableError, type Job } from 'bullmq'
import { reportJobFailure } from '../../common/monitoring'
import { EMAIL_JOBS, QUEUES } from '../../common/queue'
import type { JobPayload } from '../../common/queue'
import { MailerService } from './mailer.service'
import {
  renderCompanyVerification,
  renderDemoApproved,
  renderDemoRejected,
  renderDemoVerification,
  renderInvite,
  renderNotification,
  renderPasswordReset,
  renderTwoFactorReset,
  type CompanyVerificationPayload,
  type DemoApprovedPayload,
  type DemoRejectedPayload,
  type DemoVerificationPayload,
  type InvitePayload,
  type NotificationPayload,
  type PasswordResetPayload,
  type RenderedEmail,
  type TwoFactorResetPayload,
} from './templates'

// Сколько писем отправляем одновременно — по числу соединений в пуле SMTP (MailerService).
// По одному тысяча писем рассылки шла десятки минут, и инвайт со сбросом пароля ждали
// в том же хвосте.
const EMAIL_CONCURRENCY = 5

// Потолок темпа на очередь (на все инстансы сразу): провайдеры SMTP режут отправителя,
// превысившего лимит, а то и вносят в спам-листы — и тогда перестают доходить и инвайты.
const EMAIL_RATE_LIMIT = { max: 10, duration: 1000 }

// Воркер очереди `email`: рендерит шаблон по имени job'а и отправляет письмо.
// Идемпотентность отправки обеспечивается детерминированным jobId на стороне продюсера
// (BullMQ отбрасывает дубликат) — сам процессор писем не хранит состояние.
// Порядок: транзакционные письма ставятся без приоритета и идут раньше писем-зеркал
// уведомлений, которые ставятся с приоритетом (NotificationsProcessor).
@Processor(QUEUES.EMAIL, { concurrency: EMAIL_CONCURRENCY, limiter: EMAIL_RATE_LIMIT })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name)

  constructor(private readonly mailer: MailerService) {
    super()
  }

  /**
   * Событие `failed` приходит на КАЖДУЮ неудачную попытку, а у почты их восемь (F-F20):
   * отчёт в Sentry на каждую превратил бы минутный сбой SMTP в тысячи событий. Поэтому
   * промежуточная попытка — строка в журнале, а исчерпавший попытки job — лог + Sentry
   * (Ф13.8), как раньше. `job.data` в трекер не уходит (в payload'ах — получатели, §11.3).
   *
   * Окончательно упавший job остаётся в Redis на неделю — по нему видно, что письмо
   * потеряно, и почему. Но payload ему там уже не нужен, а в нём адрес, имя и действующая
   * ссылка-приглашение или ссылка сброса пароля: токен в ней сырой, в базе лежит только
   * хэш, и собрать ссылку заново при отправке нечем. Поэтому данные упавшего письма
   * стираются сразу, остаются имя job'а, причина и служебные `_meta`.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<JobPayload> | undefined, error: Error): Promise<void> {
    if (job && !isFinalFailure(job)) {
      this.logger.warn(
        `Письмо ${job.name} не отправлено, попытка ${job.attemptsMade} — повторим (jobId=${job.id ?? '?'}): ${error.message}`,
      )
      return
    }
    reportJobFailure(this.logger, QUEUES.EMAIL, job, error)
    if (!job) return
    try {
      await job.updateData({ _meta: job.data?._meta } as JobPayload)
    } catch (scrubError) {
      // Job уже вытеснен лимитом хранения — стирать нечего.
      this.logger.warn(
        `Не удалось стереть данные упавшего письма (jobId=${job.id ?? '?'}): ${String(scrubError)}`,
      )
    }
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const { _meta, ...data } = job.data
    const requestId = _meta?.requestId

    const rendered = this.render(job.name, data)
    if (!rendered) {
      // Пробрасываем: неизвестный job не должен молча считаться успешным (BACKEND_RULES §9.2).
      // Unrecoverable — повтор его не починит, а попыток у почты восемь.
      throw new UnrecoverableError(`Неизвестный email job: ${job.name}`)
    }

    const to = (data as { to?: string }).to
    if (!to) {
      throw new UnrecoverableError(`email job ${job.name} без получателя (jobId=${job.id ?? '?'})`)
    }

    await this.mailer.send({ to, ...rendered })
    // Адрес получателя в лог не пишем: это ПДн (§13), а найти письмо можно по jobId.
    this.logger.log(
      `Отправлено письмо ${job.name} (jobId=${job.id ?? '?'}, requestId=${requestId ?? '-'})`,
    )
  }

  private render(name: string, data: Record<string, unknown>): RenderedEmail | null {
    switch (name) {
      case EMAIL_JOBS.SEND_INVITE:
        return renderInvite(data as unknown as InvitePayload)
      case EMAIL_JOBS.SEND_NOTIFICATION:
        return renderNotification(data as unknown as NotificationPayload)
      case EMAIL_JOBS.SEND_COMPANY_VERIFICATION:
        return renderCompanyVerification(data as unknown as CompanyVerificationPayload)
      case EMAIL_JOBS.SEND_PASSWORD_RESET:
        return renderPasswordReset(data as unknown as PasswordResetPayload)
      case EMAIL_JOBS.SEND_TWO_FACTOR_RESET:
        return renderTwoFactorReset(data as unknown as TwoFactorResetPayload)
      case EMAIL_JOBS.SEND_DEMO_VERIFICATION:
        return renderDemoVerification(data as unknown as DemoVerificationPayload)
      case EMAIL_JOBS.SEND_DEMO_APPROVED:
        return renderDemoApproved(data as unknown as DemoApprovedPayload)
      case EMAIL_JOBS.SEND_DEMO_REJECTED:
        return renderDemoRejected(data as unknown as DemoRejectedPayload)
      default:
        return null
    }
  }
}

/**
 * Попыток больше не будет: исчерпаны, либо ошибка неисправимая (`finishedOn` BullMQ ставит,
 * только когда переводит job в failed окончательно).
 */
function isFinalFailure(job: Job): boolean {
  return job.finishedOn != null || job.attemptsMade >= (job.opts?.attempts ?? 1)
}
