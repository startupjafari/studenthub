import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MediaStatus, Prisma, StickerSetKind } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  USER_STICKER_LIMITS,
  type StickerSetPreviewQuery,
  type UserStickerReorderInput,
  type UserStickerSetCreateInput,
  type UserStickerSetUpdateInput,
  type UserStickerUploadFieldsInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import { MEDIA_JOBS, QUEUES, QueueService } from '../../common/queue'
import { RealtimeGateway } from '../../common/realtime'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import {
  StickerSourceError,
  encodeStaticSticker,
  isAnimatedWebp,
  sniffStickerSource,
  type StickerSourceKind,
} from '../media/sticker-encode'
import type { StickerJobData } from '../media/sticker-processing.service'
import { ChatStickersService, STICKER_SELECT, type StickerDto } from './chat-stickers.service'

/** Стикер своего набора в выдаче владельцу: со статусом сборки, ссылка — когда готов. */
export interface MyStickerDto {
  id: string
  emoji: string | null
  width: number | null
  height: number | null
  animated: boolean
  status: 'PROCESSING' | 'READY' | 'FAILED'
  url: string | null
  expiresAt: string | null
}

/** Свой набор на экране «Мои наборы». `removed` — снят модерацией (виден только владельцу). */
export interface MyStickerSetDto {
  id: string
  title: string
  slug: string
  removed: boolean
  createdAt: Date
  stickers: MyStickerDto[]
}

/** Личный набор в панели стикеров (добавленный себе, свой или чужой). */
export interface AddedStickerSetDto {
  id: string
  title: string
  slug: string
  isMine: boolean
  stickers: StickerDto[]
}

/** Превью набора по ссылке или по стикеру из переписки. */
export interface StickerSetPreviewDto {
  id: string
  title: string
  slug: string
  kind: 'CATALOG' | 'USER'
  isMine: boolean
  /** Набор уже в панели: у каталога всегда true — он у всех. */
  isAdded: boolean
  stickers: StickerDto[]
}

/** Исходник стикера: файл с устройства или вложение переписки. */
export interface StickerUpload {
  file?: { buffer: Buffer; filename?: string }
  overlay?: Buffer
  fields: UserStickerUploadFieldsInput
}

/** Сигнал своим устройствам: личные или добавленные наборы изменились — перечитать. */
const SETS_CHANGED = 'stickers:sets-changed'

/** Длина случайной части короткого имени личного набора. */
const SLUG_RANDOM_LEN = 10
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Короткое имя для ссылки: `u` + 10 знаков [a-z0-9] — подходит и под правило каталога. */
export function randomStickerSlug(): string {
  const bytes = randomBytes(SLUG_RANDOM_LEN)
  let out = 'u'
  for (const byte of bytes) out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length]
  return out
}

/** Живой личный набор (не удалён и не снят): его видят по ссылке и в панели. */
const LIVE_USER_SET_WHERE = {
  kind: StickerSetKind.USER,
  deletedAt: null,
  removedAt: null,
} satisfies Prisma.StickerSetWhereInput

/** Стикеры набора для показа другим: готовые и не убранные владельцем, по порядку. */
const SHOWN_STICKERS = {
  where: { status: MediaStatus.READY, deletedAt: null },
  select: STICKER_SELECT,
  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  take: USER_STICKER_LIMITS.STICKERS_PER_SET,
} satisfies Prisma.StickerSet$stickersArgs

function limitReached(field: 'sets' | 'stickers' | 'added', message: string): AppException {
  return new AppException('STICKER_LIMIT_REACHED', message, [{ field, message }])
}

function sourceInvalid(problem: string): AppException {
  const text: Record<string, string> = {
    type: 'Стикер делается из картинки, GIF или короткого видео',
    pixels: 'Картинка слишком большая для стикера',
    frames: 'В анимации слишком много кадров',
    decode: 'Не удалось прочитать файл',
    heavy: 'Не получилось уложить стикер в 512 КБ — выберите отрезок покороче или проще',
  }
  return new AppException('STICKER_SOURCE_INVALID', text[problem] ?? text.decode!)
}

/**
 * Свои стикеры (docs/PROJECT.md «Свои стикеры»): любой пользователь собирает личные наборы,
 * делится ими ссылкой `/addstickers/<slug>`, другие добавляют набор себе. Модерация — по
 * жалобам (цель STICKER_SET, ComplaintsService.softDeleteTarget): снятый набор скрыт у всех,
 * решение пишется в AuditLog записью `complaint_resolved`.
 *
 * Чужие вузы не раскрываются: ни превью, ни панель не отдают автора набора — только
 * `isMine`. Набор по ссылке виден любому пользователю платформы, как ссылка-приглашение.
 *
 * Картинка стикера — WebP 512 px. Статику кодирует sharp прямо в запросе; GIF и видео
 * собирает медиа-воркер (job `build-sticker`), и до готовности стикер PROCESSING: его видит
 * только владелец в «Моих наборах», клиент перечитывает набор, пока сборка идёт.
 */
@Injectable()
export class UserStickersService {
  private readonly logger = new Logger(UserStickersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly catalog: ChatStickersService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly realtime: RealtimeGateway,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {}

  private get bucket(): string {
    return this.config.get('MINIO_BUCKET_CHAT', { infer: true })
  }

  // ── Мои наборы ──────────────────────────────────────────────────────────────

  async listMine(userId: string): Promise<MyStickerSetDto[]> {
    const sets = await this.prisma.stickerSet.findMany({
      where: { kind: StickerSetKind.USER, createdById: userId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: USER_STICKER_LIMITS.SETS_PER_USER,
      select: { id: true },
    })
    const out: MyStickerSetDto[] = []
    for (const set of sets) out.push(await this.mySet(set.id))
    return out
  }

  async getMine(userId: string, setId: string): Promise<MyStickerSetDto> {
    await this.ownSet(userId, setId, { allowRemoved: true })
    return this.mySet(setId)
  }

  /**
   * Новый набор. Сразу добавляется в панель владельца — после первого стикера он уже под
   * рукой. Короткое имя случайное: из него не вычитать ни имени, ни вуза автора.
   */
  async createMine(userId: string, input: UserStickerSetCreateInput): Promise<MyStickerSetDto> {
    const [owned, added] = await Promise.all([
      this.prisma.stickerSet.count({
        where: { kind: StickerSetKind.USER, createdById: userId, deletedAt: null },
      }),
      this.countAdded(userId),
    ])
    if (owned >= USER_STICKER_LIMITS.SETS_PER_USER) {
      throw limitReached(
        'sets',
        `Своих наборов может быть не больше ${USER_STICKER_LIMITS.SETS_PER_USER}`,
      )
    }
    if (added >= USER_STICKER_LIMITS.ADDED_SETS_MAX) {
      throw limitReached(
        'added',
        `В панели может быть не больше ${USER_STICKER_LIMITS.ADDED_SETS_MAX} наборов — уберите лишние`,
      )
    }
    let setId: string | null = null
    for (let attempt = 0; attempt < 3 && !setId; attempt++) {
      try {
        const set = await this.prisma.stickerSet.create({
          data: {
            kind: StickerSetKind.USER,
            title: input.title,
            slug: randomStickerSlug(),
            createdById: userId,
            addedBy: { create: { userId } },
          },
          select: { id: true },
        })
        setId = set.id
      } catch (error) {
        // Совпало короткое имя — пробуем другое; прочее пробрасываем.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error
        }
      }
    }
    if (!setId) throw new AppException('CONFLICT', 'Не удалось подобрать короткое имя набора')
    this.changed(userId)
    return this.mySet(setId)
  }

  async renameMine(
    userId: string,
    setId: string,
    input: UserStickerSetUpdateInput,
  ): Promise<MyStickerSetDto> {
    await this.ownSet(userId, setId)
    await this.prisma.stickerSet.update({ where: { id: setId }, data: { title: input.title } })
    this.changed(userId)
    return this.mySet(setId)
  }

  /**
   * Удалить свой набор. Мягко: у добавивших он пропадает из панели (строки «добавлен» уходят),
   * по ссылке больше не открывается, но картинки остаются — отправленные стикеры в переписке
   * по-прежнему видны (GET /chats/stickers/:id/url).
   */
  async deleteMine(userId: string, setId: string): Promise<void> {
    await this.ownSet(userId, setId, { allowRemoved: true })
    await this.prisma.$transaction([
      this.prisma.stickerSet.update({ where: { id: setId }, data: { deletedAt: new Date() } }),
      this.prisma.userStickerSet.deleteMany({ where: { setId } }),
    ])
    this.changed(userId)
  }

  /**
   * Добавить стикер в свой набор. Статика нормализуется здесь же (sharp, доли секунды) и
   * сразу READY; GIF, видео и анимированный WebP уходят в медиа-воркер — стикер PROCESSING.
   */
  async addSticker(userId: string, setId: string, upload: StickerUpload): Promise<MyStickerSetDto> {
    await this.ownSet(userId, setId)
    const count = await this.prisma.sticker.count({ where: { setId, deletedAt: null } })
    if (count >= USER_STICKER_LIMITS.STICKERS_PER_SET) {
      throw limitReached(
        'stickers',
        `В наборе может быть не больше ${USER_STICKER_LIMITS.STICKERS_PER_SET} стикеров`,
      )
    }
    const source = await this.resolveSource(userId, upload)
    const order = await this.nextOrder(setId)
    const emoji = upload.fields.emoji ?? null

    if (source.kind === 'png' || source.kind === 'jpeg' || source.kind === 'static-webp') {
      const buffer = source.buffer ?? (await this.files.getObjectBuffer(source.bucket, source.key))
      if (upload.overlay && sniffStickerSource(upload.overlay) !== 'png') {
        throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Надпись поверх — только PNG')
      }
      const f = upload.fields
      const crop =
        f.cropX !== undefined && f.cropY !== undefined && f.cropW !== undefined
          ? { x: f.cropX, y: f.cropY, w: f.cropW, h: f.cropH ?? 1 }
          : undefined
      let encoded
      try {
        encoded = await encodeStaticSticker(buffer, { crop, overlay: upload.overlay })
      } catch (error) {
        if (error instanceof StickerSourceError) throw sourceInvalid(error.problem)
        throw error
      }
      const file = await this.files.upload({
        buffer: encoded.buffer,
        bucket: this.bucket,
        ownerId: userId,
        expectedCategory: 'IMAGE',
        name: 'sticker.webp',
      })
      try {
        await this.prisma.sticker.create({
          data: {
            setId,
            fileId: file.id,
            emoji,
            order,
            width: encoded.width,
            height: encoded.height,
            animated: false,
            status: MediaStatus.READY,
          },
          select: { id: true },
        })
      } catch (error) {
        await this.files.delete(file.id).catch(() => undefined)
        throw error
      }
    } else {
      await this.scheduleAnimated(userId, setId, order, emoji, source, upload)
    }
    this.changed(userId)
    return this.mySet(setId)
  }

  /**
   * Убрать стикер из своего набора. Готовый — мягко (отправленные остаются видимыми);
   * несобранный или неудавшийся никто не видел — удаляется совсем.
   */
  async deleteSticker(userId: string, setId: string, stickerId: string): Promise<MyStickerSetDto> {
    await this.ownSet(userId, setId, { allowRemoved: true })
    const sticker = await this.prisma.sticker.findFirst({
      where: { id: stickerId, setId, deletedAt: null },
      select: { id: true, status: true, fileId: true },
    })
    if (!sticker) throw new AppException('NOT_FOUND', 'Стикер не найден')
    if (sticker.status === MediaStatus.READY) {
      await this.prisma.sticker.update({
        where: { id: stickerId },
        data: { deletedAt: new Date() },
      })
    } else if (sticker.fileId) {
      await this.files.delete(sticker.fileId)
    } else {
      await this.prisma.sticker.delete({ where: { id: stickerId } })
    }
    this.changed(userId)
    return this.mySet(setId)
  }

  /** Новый порядок: все живые стикеры набора ровно по разу. */
  async reorder(
    userId: string,
    setId: string,
    input: UserStickerReorderInput,
  ): Promise<MyStickerSetDto> {
    await this.ownSet(userId, setId)
    const live = await this.prisma.sticker.findMany({
      where: { setId, deletedAt: null },
      select: { id: true },
      take: USER_STICKER_LIMITS.STICKERS_PER_SET + 1,
    })
    const ids = new Set(live.map((s) => s.id))
    if (ids.size !== input.stickerIds.length || !input.stickerIds.every((id) => ids.has(id))) {
      throw new AppException('VALIDATION_ERROR', 'Порядок должен перечислять все стикеры набора', [
        { field: 'stickerIds', message: 'Порядок должен перечислять все стикеры набора' },
      ])
    }
    await this.prisma.$transaction(
      input.stickerIds.map((id, order) =>
        this.prisma.sticker.update({ where: { id }, data: { order } }),
      ),
    )
    this.changed(userId)
    return this.mySet(setId)
  }

  // ── Добавленные наборы (панель) ─────────────────────────────────────────────

  /** Личные наборы в моей панели: свежедобавленные сверху, только живые. */
  async listAdded(userId: string): Promise<AddedStickerSetDto[]> {
    const rows = await this.prisma.userStickerSet.findMany({
      where: { userId, set: LIVE_USER_SET_WHERE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: USER_STICKER_LIMITS.ADDED_SETS_MAX,
      select: {
        set: {
          select: {
            id: true,
            title: true,
            slug: true,
            createdById: true,
            stickers: SHOWN_STICKERS,
          },
        },
      },
    })
    const signed = await this.catalog.sign(rows.flatMap((row) => row.set.stickers))
    return rows.map(({ set }) => ({
      id: set.id,
      title: set.title,
      slug: set.slug,
      isMine: set.createdById === userId,
      stickers: set.stickers.flatMap((sticker) => signed.get(sticker.id) ?? []),
    }))
  }

  /** Добавить чужой (или убранный свой) набор в панель. Повтор — без ошибки, наверх. */
  async addSet(userId: string, setId: string): Promise<void> {
    const set = await this.prisma.stickerSet.findFirst({
      where: { id: setId, ...LIVE_USER_SET_WHERE },
      select: { id: true },
    })
    if (!set) throw new AppException('NOT_FOUND', 'Набор стикеров не найден')
    const existing = await this.prisma.userStickerSet.findUnique({
      where: { userId_setId: { userId, setId } },
      select: { id: true },
    })
    if (!existing && (await this.countAdded(userId)) >= USER_STICKER_LIMITS.ADDED_SETS_MAX) {
      throw limitReached(
        'added',
        `В панели может быть не больше ${USER_STICKER_LIMITS.ADDED_SETS_MAX} наборов — уберите лишние`,
      )
    }
    await this.prisma.userStickerSet.upsert({
      where: { userId_setId: { userId, setId } },
      create: { userId, setId },
      update: { createdAt: new Date() },
    })
    this.changed(userId)
  }

  /** Убрать набор из панели. Идемпотентно. Свой набор при этом не удаляется. */
  async removeSet(userId: string, setId: string): Promise<void> {
    await this.prisma.userStickerSet.deleteMany({ where: { userId, setId } })
    this.changed(userId)
  }

  /**
   * Превью набора: по короткому имени (ссылка) или по id (нажатие на стикер в переписке).
   * Каталог — только опубликованный, личный — только живой. Автор не раскрывается.
   */
  async preview(userId: string, query: StickerSetPreviewQuery): Promise<StickerSetPreviewDto> {
    const set = await this.prisma.stickerSet.findFirst({
      where: {
        ...(query.slug !== undefined ? { slug: query.slug } : { id: query.setId }),
        OR: [{ kind: StickerSetKind.CATALOG, isPublished: true }, LIVE_USER_SET_WHERE],
      },
      select: {
        id: true,
        kind: true,
        title: true,
        slug: true,
        createdById: true,
        stickers: SHOWN_STICKERS,
        addedBy: { where: { userId }, select: { id: true }, take: 1 },
      },
    })
    if (!set) throw new AppException('NOT_FOUND', 'Набор стикеров не найден')
    const signed = await this.catalog.sign(set.stickers)
    const isUser = set.kind === StickerSetKind.USER
    return {
      id: set.id,
      title: set.title,
      slug: set.slug,
      kind: set.kind,
      isMine: isUser && set.createdById === userId,
      isAdded: !isUser || set.addedBy.length > 0,
      stickers: set.stickers.flatMap((sticker) => signed.get(sticker.id) ?? []),
    }
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────────

  private changed(userId: string): void {
    this.realtime.emitToUser(userId, SETS_CHANGED, {})
  }

  private countAdded(userId: string): Promise<number> {
    return this.prisma.userStickerSet.count({ where: { userId, set: LIVE_USER_SET_WHERE } })
  }

  private async nextOrder(setId: string): Promise<number> {
    const last = await this.prisma.sticker.findFirst({
      where: { setId },
      orderBy: { order: 'desc' },
      select: { order: true },
    })
    return (last?.order ?? -1) + 1
  }

  /**
   * Свой набор: чужой или удалённый — NOT_FOUND (не подтверждаем чужие id). Снятый
   * модерацией владелец видит и может удалить, но не пополнять.
   */
  private async ownSet(
    userId: string,
    setId: string,
    opts: { allowRemoved?: boolean } = {},
  ): Promise<void> {
    const set = await this.prisma.stickerSet.findFirst({
      where: { id: setId, kind: StickerSetKind.USER, createdById: userId, deletedAt: null },
      select: { removedAt: true },
    })
    if (!set) throw new AppException('NOT_FOUND', 'Набор стикеров не найден')
    if (set.removedAt && !opts.allowRemoved) {
      throw new AppException('FORBIDDEN', 'Набор снят модерацией')
    }
  }

  private async mySet(setId: string): Promise<MyStickerSetDto> {
    const set = await this.prisma.stickerSet.findUniqueOrThrow({
      where: { id: setId },
      select: {
        id: true,
        title: true,
        slug: true,
        removedAt: true,
        createdAt: true,
        stickers: {
          where: { deletedAt: null },
          select: { ...STICKER_SELECT, status: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          take: USER_STICKER_LIMITS.STICKERS_PER_SET,
        },
      },
    })
    const signed = await this.catalog.sign(set.stickers)
    return {
      id: set.id,
      title: set.title,
      slug: set.slug,
      removed: set.removedAt !== null,
      createdAt: set.createdAt,
      stickers: set.stickers.map((sticker) => {
        const ready = signed.get(sticker.id)
        return {
          id: sticker.id,
          emoji: sticker.emoji,
          width: sticker.width,
          height: sticker.height,
          animated: sticker.animated,
          status:
            sticker.status === MediaStatus.READY
              ? 'READY'
              : sticker.status === MediaStatus.FAILED
                ? 'FAILED'
                : 'PROCESSING',
          url: ready?.url ?? null,
          expiresAt: ready?.expiresAt ?? null,
        }
      }),
    }
  }

  /**
   * Откуда брать исходник и что это. Файл с устройства — по magic bytes; вложение переписки —
   * только то, что автор видит сам: свой файл или вложение сообщения в чате, где он
   * действующий участник.
   */
  private async resolveSource(userId: string, upload: StickerUpload): Promise<ResolvedSource> {
    if (upload.file && upload.fields.sourceFileId) {
      throw new AppException('BAD_REQUEST', 'Либо файл, либо sourceFileId — не оба')
    }
    if (upload.file) {
      const buffer = upload.file.buffer
      if (buffer.byteLength > USER_STICKER_LIMITS.SOURCE_MAX_BYTES) {
        throw new AppException('FILE_TOO_LARGE', 'Исходник стикера — не больше 10 МБ')
      }
      const kind = await this.classify(sniffStickerSource(buffer), buffer)
      return { kind, buffer, bucket: this.bucket, key: '', temp: true }
    }
    const fileId = upload.fields.sourceFileId
    if (!fileId) throw new AppException('BAD_REQUEST', 'Нужен файл в поле "file" или sourceFileId')
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: {
        bucket: true,
        key: true,
        size: true,
        ownerId: true,
        message: { select: { chatId: true, deletedAt: true } },
      },
    })
    let visible = file !== null && file.ownerId === userId
    if (file && !visible && file.message && !file.message.deletedAt) {
      const member = await this.prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId: file.message.chatId, userId } },
        select: { bannedAt: true },
      })
      visible = member !== null && member.bannedAt === null
    }
    if (!file || !visible) throw new AppException('NOT_FOUND', 'Файл не найден')
    // Тип — по первым байтам объекта, а не по mime записи.
    const head = await this.readHead(file.bucket, file.key)
    const sniffed = sniffStickerSource(head)
    // Картинку и анимированный WebP читаем в память — им нужен тот же потолок, что и загрузке;
    // видео ffmpeg читает по ссылке сам, отрезок берёт переходом.
    const inMemory = sniffed !== 'mp4' && sniffed !== 'webm' && sniffed !== 'gif'
    if (inMemory && file.size > USER_STICKER_LIMITS.SOURCE_MAX_BYTES) {
      throw new AppException('FILE_TOO_LARGE', 'Исходник стикера — не больше 10 МБ')
    }
    const buffer =
      sniffed === 'webp' ? await this.files.getObjectBuffer(file.bucket, file.key) : undefined
    const kind = await this.classify(sniffed, buffer ?? head)
    return { kind, buffer, bucket: file.bucket, key: file.key, temp: false }
  }

  private async classify(
    sniffed: StickerSourceKind | null,
    buffer: Buffer,
  ): Promise<ResolvedSource['kind']> {
    switch (sniffed) {
      case 'png':
      case 'jpeg':
        return sniffed
      case 'gif':
        return 'gif'
      case 'mp4':
      case 'webm':
        return 'video'
      case 'webp':
        try {
          return (await isAnimatedWebp(buffer)) ? 'animated-webp' : 'static-webp'
        } catch {
          throw sourceInvalid('decode')
        }
      default:
        throw sourceInvalid('type')
    }
  }

  private async readHead(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.minio.getPartialObject(bucket, key, 0, 64)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  }

  /**
   * Анимация — в воркер: стикер PROCESSING без картинки, исходник с устройства и надпись —
   * временными объектами в бакете чатов (их уберёт job, а брошенные — ночная чистка сирот).
   */
  private async scheduleAnimated(
    userId: string,
    setId: string,
    order: number,
    emoji: string | null,
    source: ResolvedSource,
    upload: StickerUpload,
  ): Promise<void> {
    let sourceKey = source.key
    const tempKeys: string[] = []
    if (source.temp && source.buffer) {
      sourceKey = `sticker-src/${randomUUID()}`
      await this.minio.putObject(this.bucket, sourceKey, source.buffer, source.buffer.byteLength)
      tempKeys.push(sourceKey)
    }
    let overlayKey: string | undefined
    if (upload.overlay && source.kind !== 'animated-webp') {
      if (sniffStickerSource(upload.overlay) !== 'png') {
        await this.removeTemp(tempKeys)
        throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Надпись поверх — только PNG')
      }
      overlayKey = `sticker-src/${randomUUID()}.png`
      await this.minio.putObject(this.bucket, overlayKey, upload.overlay, upload.overlay.byteLength)
      tempKeys.push(overlayKey)
    }
    const sticker = await this.prisma.sticker.create({
      data: { setId, emoji, order, animated: true, status: MediaStatus.PROCESSING },
      select: { id: true },
    })
    const f = upload.fields
    const data: StickerJobData = {
      stickerId: sticker.id,
      ownerId: userId,
      sourceBucket: source.temp ? this.bucket : source.bucket,
      sourceKey,
      ...(source.temp ? { sourceTemp: '1' } : {}),
      kind: source.kind === 'gif' ? 'gif' : source.kind === 'video' ? 'video' : 'webp',
      startMs: String(f.startMs ?? 0),
      durationMs: String(f.durationMs ?? USER_STICKER_LIMITS.ANIMATION_MAX_MS),
      ...(f.cropX !== undefined ? { crop: [f.cropX, f.cropY, f.cropW, f.cropH].join(',') } : {}),
      ...(overlayKey ? { overlayKey } : {}),
    }
    const queued = await this.queue.enqueue(QUEUES.MEDIA_VIDEO, MEDIA_JOBS.STICKER, data, {
      jobId: `sticker_${sticker.id}`,
      attempts: 2,
    })
    if (!queued) {
      // Очередь недоступна: стикер честно «не вышло», временные объекты — убрать.
      this.logger.warn(`Стикер ${sticker.id}: не удалось поставить сборку в очередь`)
      await this.prisma.sticker.update({
        where: { id: sticker.id },
        data: { status: MediaStatus.FAILED },
      })
      await this.removeTemp(tempKeys)
    }
  }

  private async removeTemp(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.minio.removeObject(this.bucket, key).catch(() => undefined)
    }
  }
}

interface ResolvedSource {
  kind: 'png' | 'jpeg' | 'static-webp' | 'animated-webp' | 'gif' | 'video'
  /** Байты в памяти: загрузка с устройства или WebP из переписки. */
  buffer?: Buffer
  bucket: string
  key: string
  /** Исходник с устройства — в воркер уходит временной копией. */
  temp: boolean
}
