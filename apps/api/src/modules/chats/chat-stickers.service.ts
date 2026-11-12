import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import {
  STICKER_LIMITS,
  type ChatStickerSendInput,
  type StickerSetCreateInput,
  type StickerSetUpdateInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { AuditService } from '../../common/audit/audit.service'
import { signingWindow } from '../../common/minio/stable-sign'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import { ChatsService, type MessageRow } from './chats.service'

const STICKER_SELECT = {
  id: true,
  emoji: true,
  width: true,
  height: true,
  order: true,
  fileId: true,
} satisfies Prisma.StickerSelect

type StickerRow = Prisma.StickerGetPayload<{ select: typeof STICKER_SELECT }>

/** Стикер в выдаче каталога: подписанная ссылка на картинку и её срок. */
export interface StickerDto {
  id: string
  emoji: string | null
  width: number | null
  height: number | null
  url: string
  expiresAt: string
}

export interface StickerSetDto {
  id: string
  title: string
  slug: string
  stickers: StickerDto[]
}

/** Набор в админской выдаче: ещё и неопубликованные, с порядком и флагом публикации. */
export interface StickerSetAdminDto extends StickerSetDto {
  order: number
  isPublished: boolean
  createdAt: Date
  updatedAt: Date
}

const AUDIT_ACTION = {
  setCreated: 'sticker_set_created',
  setUpdated: 'sticker_set_updated',
  setDeleted: 'sticker_set_deleted',
  stickerAdded: 'sticker_added',
  stickerDeleted: 'sticker_deleted',
} as const

/**
 * Каталог стикеров чатов (Telegram-стиль). Наборы заводит и публикует только платформенный
 * администратор; сторонних наборов платформа не поставляет.
 *
 * Картинки лежат в приватном бакете чатов записями File (1:1 со стикером) и отдаются
 * подписанными ссылками с тем же сроком, что у вложений (BACKEND_RULES §8: 15 минут, подпись
 * стабильна в пределах окна — повторная выдача каталога даёт те же URL, и клиент берёт байты
 * из кеша). Освежить одну ссылку — `GET /chats/stickers/:stickerId/url`.
 *
 * Сообщение со стикером хранит только `stickerId`: копировать картинку в каждое сообщение
 * незачем. Удалили стикер из каталога — у отправленных связь обнуляется, клиент пишет
 * «стикер недоступен».
 */
@Injectable()
export class ChatStickersService {
  private readonly logger = new Logger(ChatStickersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly chats: ChatsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ── Каталог для клиентов ────────────────────────────────────────────────────

  /** Опубликованные наборы по порядку, со стикерами и ссылками на картинки. */
  async listPublished(): Promise<StickerSetDto[]> {
    const sets = await this.prisma.stickerSet.findMany({
      where: { isPublished: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      take: STICKER_LIMITS.SETS_MAX,
      select: {
        id: true,
        title: true,
        slug: true,
        stickers: {
          select: STICKER_SELECT,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          take: STICKER_LIMITS.STICKERS_PER_SET_MAX,
        },
      },
    })
    const signed = await this.sign(sets.flatMap((set) => set.stickers))
    return sets.map((set) => ({
      id: set.id,
      title: set.title,
      slug: set.slug,
      stickers: set.stickers.flatMap((sticker) => signed.get(sticker.id) ?? []),
    }))
  }

  /** Свежая ссылка на картинку одного стикера (опубликованного набора). */
  async stickerUrl(stickerId: string): Promise<{ url: string; expiresAt: string }> {
    const sticker = await this.prisma.sticker.findFirst({
      where: { id: stickerId, set: { isPublished: true } },
      select: STICKER_SELECT,
    })
    if (!sticker) throw new AppException('NOT_FOUND', 'Стикер не найден')
    const dto = (await this.sign([sticker])).get(sticker.id)
    if (!dto) throw new AppException('NOT_FOUND', 'Стикер не найден')
    return { url: dto.url, expiresAt: dto.expiresAt }
  }

  /** Отправить стикер (`POST /chats/:id/sticker`) — только из опубликованного набора. */
  async send(senderId: string, chatId: string, input: ChatStickerSendInput): Promise<MessageRow> {
    const sticker = await this.prisma.sticker.findFirst({
      where: { id: input.stickerId, set: { isPublished: true } },
      select: { id: true },
    })
    if (!sticker) throw new AppException('NOT_FOUND', 'Стикер не найден')
    return this.chats.sendRichMessage(senderId, chatId, {
      replyToId: input.replyToId,
      nonce: input.nonce,
      data: { stickerId: sticker.id },
    })
  }

  // ── Управление каталогом (PLATFORM_ADMIN) ───────────────────────────────────

  async listAll(): Promise<StickerSetAdminDto[]> {
    const sets = await this.prisma.stickerSet.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      take: STICKER_LIMITS.SETS_MAX,
      select: {
        id: true,
        title: true,
        slug: true,
        order: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        stickers: {
          select: STICKER_SELECT,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          take: STICKER_LIMITS.STICKERS_PER_SET_MAX,
        },
      },
    })
    const signed = await this.sign(sets.flatMap((set) => set.stickers))
    return sets.map(({ stickers, ...set }) => ({
      ...set,
      stickers: stickers.flatMap((sticker) => signed.get(sticker.id) ?? []),
    }))
  }

  async createSet(actorId: string, input: StickerSetCreateInput): Promise<StickerSetAdminDto> {
    const last = await this.prisma.stickerSet.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    })
    let set: { id: string; createdAt: Date; updatedAt: Date; order: number; isPublished: boolean }
    try {
      set = await this.prisma.stickerSet.create({
        data: {
          title: input.title,
          slug: input.slug,
          order: (last?.order ?? -1) + 1,
          createdById: actorId,
        },
        select: { id: true, createdAt: true, updatedAt: true, order: true, isPublished: true },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Набор с таким коротким именем уже есть')
      }
      throw error
    }
    await this.audit.record({
      userId: actorId,
      action: AUDIT_ACTION.setCreated,
      entity: 'StickerSet',
      entityId: set.id,
      metadata: { slug: input.slug },
    })
    return { ...set, title: input.title, slug: input.slug, stickers: [] }
  }

  async updateSet(
    actorId: string,
    setId: string,
    input: StickerSetUpdateInput,
  ): Promise<StickerSetAdminDto> {
    await this.findSet(setId)
    await this.prisma.stickerSet.update({
      where: { id: setId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      },
    })
    await this.audit.record({
      userId: actorId,
      action: AUDIT_ACTION.setUpdated,
      entity: 'StickerSet',
      entityId: setId,
      metadata: { ...input },
    })
    return this.adminSet(setId)
  }

  /**
   * Удалить набор целиком. Картинки уходят вместе с записями File (объект в хранилище снимает
   * FileService, если на него больше никто не ссылается); у отправленных сообщений стикер
   * становится «недоступен».
   */
  async deleteSet(actorId: string, setId: string): Promise<void> {
    await this.findSet(setId)
    const stickers = await this.prisma.sticker.findMany({
      where: { setId },
      select: { fileId: true },
      take: STICKER_LIMITS.STICKERS_PER_SET_MAX,
    })
    await this.prisma.stickerSet.delete({ where: { id: setId } })
    await this.removeFiles(stickers.map((sticker) => sticker.fileId))
    await this.audit.record({
      userId: actorId,
      action: AUDIT_ACTION.setDeleted,
      entity: 'StickerSet',
      entityId: setId,
      metadata: { stickers: stickers.length },
    })
  }

  /**
   * Добавить стикер: png, webp или gif не больше 512 КБ. Тип — по содержимому (magic bytes),
   * как у любой загрузки; размеры кадра считает FileService при загрузке.
   */
  async addSticker(
    actorId: string,
    setId: string,
    file: { buffer: Buffer; name?: string },
    emoji: string | undefined,
  ): Promise<StickerSetAdminDto> {
    await this.findSet(setId)
    if (file.buffer.byteLength > STICKER_LIMITS.MAX_BYTES) {
      throw new AppException('FILE_TOO_LARGE', 'Стикер — не больше 512 КБ')
    }
    const count = await this.prisma.sticker.count({ where: { setId } })
    if (count >= STICKER_LIMITS.STICKERS_PER_SET_MAX) {
      throw new AppException(
        'BAD_REQUEST',
        `В наборе не может быть больше ${STICKER_LIMITS.STICKERS_PER_SET_MAX} стикеров`,
      )
    }
    const uploaded = await this.files.upload({
      buffer: file.buffer,
      bucket: this.config.get('MINIO_BUCKET_CHAT', { infer: true }),
      ownerId: actorId,
      expectedCategory: 'IMAGE',
      name: file.name,
    })
    if (!(STICKER_LIMITS.MIMES as readonly string[]).includes(uploaded.mime)) {
      await this.removeFiles([uploaded.id])
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Стикер — только PNG, WebP или GIF')
    }
    try {
      const sticker = await this.prisma.sticker.create({
        data: {
          setId,
          fileId: uploaded.id,
          emoji: emoji ?? null,
          order: count,
          width: uploaded.width ?? null,
          height: uploaded.height ?? null,
        },
        select: { id: true },
      })
      await this.audit.record({
        userId: actorId,
        action: AUDIT_ACTION.stickerAdded,
        entity: 'Sticker',
        entityId: sticker.id,
        metadata: { setId },
      })
    } catch (error) {
      await this.removeFiles([uploaded.id])
      throw error
    }
    return this.adminSet(setId)
  }

  async deleteSticker(
    actorId: string,
    setId: string,
    stickerId: string,
  ): Promise<StickerSetAdminDto> {
    const sticker = await this.prisma.sticker.findFirst({
      where: { id: stickerId, setId },
      select: { id: true, fileId: true },
    })
    if (!sticker) throw new AppException('NOT_FOUND', 'Стикер не найден')
    // Запись стикера уходит каскадом вместе с File (Sticker.file onDelete: Cascade). Здесь
    // сбой не глушим: иначе стикер остался бы в наборе, а ответ сказал бы «удалён».
    await this.files.delete(sticker.fileId)
    await this.audit.record({
      userId: actorId,
      action: AUDIT_ACTION.stickerDeleted,
      entity: 'Sticker',
      entityId: stickerId,
      metadata: { setId },
    })
    return this.adminSet(setId)
  }

  private async findSet(setId: string): Promise<void> {
    const set = await this.prisma.stickerSet.findUnique({
      where: { id: setId },
      select: { id: true },
    })
    if (!set) throw new AppException('NOT_FOUND', 'Набор стикеров не найден')
  }

  private async adminSet(setId: string): Promise<StickerSetAdminDto> {
    const set = await this.prisma.stickerSet.findUniqueOrThrow({
      where: { id: setId },
      select: {
        id: true,
        title: true,
        slug: true,
        order: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        stickers: {
          select: STICKER_SELECT,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          take: STICKER_LIMITS.STICKERS_PER_SET_MAX,
        },
      },
    })
    const signed = await this.sign(set.stickers)
    const { stickers, ...rest } = set
    return { ...rest, stickers: stickers.flatMap((sticker) => signed.get(sticker.id) ?? []) }
  }

  /** Подписанные ссылки на картинки — одной пачкой на весь каталог. */
  private async sign(stickers: StickerRow[]): Promise<Map<string, StickerDto>> {
    const urls = await this.files.getPresignedUrls(stickers.map((sticker) => sticker.fileId))
    const expiresAt = signingWindow(Date.now()).expiresAt.toISOString()
    const out = new Map<string, StickerDto>()
    for (const sticker of stickers) {
      const url = urls.get(sticker.fileId)
      if (!url) continue
      out.set(sticker.id, {
        id: sticker.id,
        emoji: sticker.emoji,
        width: sticker.width,
        height: sticker.height,
        url,
        expiresAt,
      })
    }
    return out
  }

  /** Удалить файлы стикеров. Сбой уборки не роняет действие — остатки снимут ночные чистки. */
  private async removeFiles(fileIds: string[]): Promise<void> {
    for (const fileId of fileIds) {
      await this.files.delete(fileId).catch((error: unknown) => {
        this.logger.warn(`Не удалось удалить файл стикера ${fileId}: ${String(error)}`)
      })
    }
  }
}
