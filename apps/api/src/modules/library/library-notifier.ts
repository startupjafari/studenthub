import { Injectable } from '@nestjs/common'
import type { NotificationMessageKey, NotificationParams } from '@studenthub/shared-config'
import { QueueService } from '../../common/queue/queue.service'
import { NOTIFICATION_JOBS, QUEUES } from '../../common/queue/queue.constants'

// Уведомления библиотеки (Фаза 20): тексты — словарные статьи `library.*` (shared-config),
// доставка — общей очередью уведомлений (WS, push, письмо офлайн-получателю). Ключ дедупа на
// событие: повтор job'а не шлёт второе уведомление.

export type LibraryJob =
  | typeof NOTIFICATION_JOBS.LIBRARY_LOAN
  | typeof NOTIFICATION_JOBS.LIBRARY_REMINDER
  | typeof NOTIFICATION_JOBS.LIBRARY_RESERVATION

export interface LibraryNotice {
  recipientIds: string[]
  job: LibraryJob
  titleKey: NotificationMessageKey
  bodyKey: NotificationMessageKey
  params: NotificationParams
  url: string
  dedupeKey: string
}

@Injectable()
export class LibraryNotifier {
  constructor(private readonly queue: QueueService) {}

  async send(notice: LibraryNotice): Promise<void> {
    if (notice.recipientIds.length === 0) return
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      notice.job,
      {
        recipientIds: notice.recipientIds,
        type: 'SYSTEM',
        titleKey: notice.titleKey,
        bodyKey: notice.bodyKey,
        params: notice.params,
        data: { url: notice.url },
        dedupeKey: notice.dedupeKey,
      },
      { jobId: notice.dedupeKey },
    )
  }
}
