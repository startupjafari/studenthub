import { Injectable, Logger } from '@nestjs/common'
import { SAVED_GIFS_LIMIT } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import { FileService } from '../files/file.service'
import { MediaService } from '../media/media.service'
import {
  GIF_FILE_SELECT,
  gifFingerprint,
  isGifFile,
  toGifItems,
  type GifFileRow,
  type GifItemDto,
} from './chat-gif-items'
import { ChatsService } from './chats.service'

/** Сигнал своим устройствам: «Мои GIF» изменились — перечитать список. */
export const SAVED_GIFS_CHANGED_EVENT = 'gifs:saved-changed'

/** GIF из «Моих GIF»: плитка панели + своя запись и то, откуда сохранён. */
export interface SavedGifDto extends GifItemDto {
  /** id записи «Моих GIF» — для `DELETE /chats/gifs/saved/:id`. */
  id: string
  /** Вложение, из которого сохранили: по нему меню сообщения показывает «Убрать из GIF». */
  sourceFileId: string | null
  /** `<size>:<width>:<height>` источника — узнать тот же GIF в другой пересылке. */
  fingerprint: string
  createdAt: string
}

const SAVED_SELECT = {
  id: true,
  sourceFileId: true,
  fingerprint: true,
  createdAt: true,
  file: { select: GIF_FILE_SELECT },
} as const

type SavedRow = {
  id: string
  sourceFileId: string | null
  fingerprint: string
  createdAt: Date
  file: GifFileRow
}

/**
 * «Мои GIF» как в Telegram (docs/PROJECT.md §8, «GIF»): сохранить полученный GIF себе одним
 * касанием и отправлять его потом из панели поля ввода.
 *
 * Сохранённый — своя запись File на тот же объект хранилища, что у вложения-источника
 * (`FileService.cloneRecord`): байты не копируются, а GIF остаётся у человека, даже когда
 * источник удалили или он вышел из чата. Отправка — `POST /chats/:id/gif` с `fileId` этой
 * записи (копия на новый ключ, как у недавних). До 200 штук, свежие сверху; повторное
 * сохранение того же GIF поднимает запись наверх, сверх лимита уходит самый давний.
 * Изменения рассылаются своим устройствам событием `gifs:saved-changed`.
 */
@Injectable()
export class ChatSavedGifsService {
  private readonly logger = new Logger(ChatSavedGifsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly media: MediaService,
    private readonly chats: ChatsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** «Мои GIF» (`GET /chats/gifs/saved`): свежие сверху, не больше 200. */
  async list(userId: string): Promise<SavedGifDto[]> {
    const rows = await this.prisma.savedGif.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SAVED_GIFS_LIMIT,
      select: SAVED_SELECT,
    })
    return this.toDtos(rows)
  }

  /**
   * Сохранить GIF (`POST /chats/gifs/saved`). Источник — GIF-вложение живого сообщения в
   * чате, где человек участник, — по тому же правилу, что ссылка на вложение и повтор GIF.
   * Уже сохранённый (то же вложение или тот же GIF из другой пересылки) поднимается наверх.
   */
  async save(userId: string, fileId: string): Promise<SavedGifDto> {
    const source = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: {
        ...GIF_FILE_SELECT,
        key: true,
        name: true,
        asDocument: true,
        message: { select: { chatId: true, deletedAt: true } },
        savedGif: { select: { id: true, userId: true } },
      },
    })
    if (!source || source.asDocument || !isGifFile(source)) {
      throw new AppException('NOT_FOUND', 'GIF не найден')
    }
    // Свой сохранённый (плитка «Моих GIF») — просто наверх.
    if (source.savedGif?.userId === userId) return this.bump(userId, source.savedGif.id)
    if (!source.message || source.message.deletedAt) {
      throw new AppException('NOT_FOUND', 'GIF не найден')
    }
    await this.chats.assertMembership(userId, source.message.chatId)

    const fingerprint = gifFingerprint(source)
    const existing = await this.prisma.savedGif.findFirst({
      where: { userId, OR: [{ sourceFileId: fileId }, { fingerprint }] },
      select: { id: true },
    })
    if (existing) return this.bump(userId, existing.id)

    const clone = await this.files.cloneRecord(source, userId)
    let savedId: string
    try {
      const saved = await this.prisma.savedGif.create({
        data: { userId, fileId: clone.id, sourceFileId: fileId, fingerprint },
        select: { id: true },
      })
      savedId = saved.id
    } catch (error) {
      await this.files.delete(clone.id).catch(() => undefined)
      throw error
    }
    await this.evictOverflow(userId)
    this.realtime.emitToUser(userId, SAVED_GIFS_CHANGED_EVENT, {})
    return this.one(userId, savedId)
  }

  /** Убрать из «Моих GIF» (`DELETE /chats/gifs/saved/:id`). Нечего убирать — тоже успех. */
  async remove(userId: string, id: string): Promise<void> {
    const row = await this.prisma.savedGif.findFirst({
      where: { id, userId },
      select: { fileId: true },
    })
    if (!row) return
    // Запись File уходит вместе с сохранённым (каскад); объект — только если на него больше
    // никто не ссылается (вложение-источник обычно ещё живо).
    await this.files.delete(row.fileId)
    this.realtime.emitToUser(userId, SAVED_GIFS_CHANGED_EVENT, {})
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  private async bump(userId: string, id: string): Promise<SavedGifDto> {
    await this.prisma.savedGif.update({ where: { id }, data: { createdAt: new Date() } })
    this.realtime.emitToUser(userId, SAVED_GIFS_CHANGED_EVENT, {})
    return this.one(userId, id)
  }

  /** Сверх лимита — самые давние уходят вместе со своими записями File. */
  private async evictOverflow(userId: string): Promise<void> {
    const overflow = await this.prisma.savedGif.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: SAVED_GIFS_LIMIT,
      take: SAVED_GIFS_LIMIT,
      select: { fileId: true },
    })
    for (const row of overflow) {
      await this.files.delete(row.fileId).catch((error: unknown) => {
        this.logger.warn(`Вытесняемый GIF ${row.fileId} не удалён: ${String(error)}`)
      })
    }
  }

  private async one(userId: string, id: string): Promise<SavedGifDto> {
    const row = await this.prisma.savedGif.findFirst({
      where: { id, userId },
      select: SAVED_SELECT,
    })
    const [dto] = row ? await this.toDtos([row]) : []
    if (!dto) throw new AppException('NOT_FOUND', 'GIF не найден')
    return dto
  }

  private async toDtos(rows: SavedRow[]): Promise<SavedGifDto[]> {
    const items = await toGifItems(
      rows.map((row) => row.file),
      this.files,
      this.media,
    )
    return rows.flatMap((row) => {
      const item = items.get(row.file.id)
      if (!item) return []
      return [
        {
          ...item,
          id: row.id,
          sourceFileId: row.sourceFileId,
          fingerprint: row.fingerprint,
          createdAt: row.createdAt.toISOString(),
        },
      ]
    })
  }
}
