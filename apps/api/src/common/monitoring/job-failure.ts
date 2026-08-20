import type { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { captureUnexpected } from './sentry'

// Единый обработчик падения job'а для всех воркеров BullMQ (§10.1, Ф13.8).
// До этого исчерпавший попытки job уходил в failed молча: письмо/уведомление/push
// не доставлены, а в логах и трекере — ничего.

/**
 * Логирует и отправляет в Sentry падение job'а.
 *
 * `job.data` НАРУЖУ НЕ УХОДИТ: в payload'ах очередей лежат адреса получателей,
 * тексты уведомлений и сообщений (§13, §11.3). В событие попадают только имя очереди,
 * имя job'а, его id, номер попытки и requestId из `_meta` для склейки с логами.
 */
export function reportJobFailure(
  logger: Logger,
  queue: string,
  job: Job<{ _meta?: { requestId?: string } }> | undefined,
  error: Error,
): void {
  const requestId = job?.data?._meta?.requestId
  const jobName = job?.name ?? 'unknown'
  const jobId = job?.id ?? '?'
  const attempts = job?.attemptsMade

  const eventId = captureUnexpected(error, {
    source: 'queue',
    requestId,
    path: `${queue}/${jobName}`,
    extra: { queue, jobName, jobId, attemptsMade: attempts },
  })

  logger.error(
    {
      err: error,
      queue,
      jobName,
      jobId,
      attemptsMade: attempts,
      requestId,
      ...(eventId ? { sentryEventId: eventId } : {}),
    },
    `Job ${queue}/${jobName} упал (jobId=${jobId})`,
  )
}
