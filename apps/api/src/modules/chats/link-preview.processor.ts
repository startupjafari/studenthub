import { Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { reportJobFailure } from '../../common/monitoring'
import { QUEUES } from '../../common/queue'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import { LinkPreviewService } from '../../common/link-preview/link-preview.service'
import { ChatsService } from './chats.service'

interface LinkPreviewJob {
  messageId: string
  chatId: string
  url: string
}

// Сколько ссылок разбираем одновременно. С одним обработчиком «медленный» сайт держал
// очередь целиком — превью остальных сообщений ждали его срока. Выборка — сетевое
// ожидание, а не CPU: несколько параллельных стоят процессу почти ничего.
const LINK_PREVIEW_CONCURRENCY = 6

// Воркер очереди link-preview: тянет OG-мета по ссылке, пишет в Message.linkPreview и
// рассылает message:updated в комнату чата (карточка появляется у всех участников).
@Processor(QUEUES.LINK_PREVIEW, { concurrency: LINK_PREVIEW_CONCURRENCY })
export class LinkPreviewProcessor extends WorkerHost {
  private readonly logger = new Logger(LinkPreviewProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinkPreviewService,
    private readonly realtime: RealtimeGateway,
    private readonly chats: ChatsService,
  ) {
    super()
  }

  // Ф13.8: исчерпавший попытки job больше не пропадает молча — лог + Sentry.
  // `job.data` в трекер не уходит (в payload'ах — получатели и тексты, §11.3).
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(this.logger, QUEUES.LINK_PREVIEW, job, error)
  }

  async process(job: Job<LinkPreviewJob>): Promise<void> {
    const { messageId, chatId, url } = job.data
    const fetched = await this.links.fetch(url)
    // Пусто (нераспознано/недоступно/SSRF-блок) или без заголовка — карточку не рисуем.
    if (!fetched?.title) return
    // Картинку OG не сохраняем (F-F29): это адрес на чужом сайте, и клиенты грузили его
    // напрямую — каждый читатель чата отдавал свой IP (и время прочтения) владельцу ссылки.
    // Показывать её можно будет, когда появится копия в своём хранилище; до тех пор карточка
    // — заголовок, описание и сайт. Поле остаётся в форме превью: клиенты его ждут.
    const preview = { ...fetched, image: null }

    // Сообщение могли удалить, пока тянули превью — обновляем только существующее и не удалённое.
    const updated = await this.prisma.message.updateMany({
      where: { id: messageId, deletedAt: null },
      data: { linkPreview: preview as unknown as Prisma.InputJsonValue },
    })
    if (updated.count === 0) return

    // Рассылаем в клиентской форме (со связями), иначе фронт затрёт sender/media.
    const message = await this.chats.findMessageForClient(messageId)
    if (message) {
      this.realtime.emitToRoom(`chat:${chatId}`, 'message:updated', { message, chatId })
    }
    this.logger.debug(`link-preview готов для message=${messageId}`)
  }
}
