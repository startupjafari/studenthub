import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import {
  FILE_UPLOAD,
  PROFILE_MEDIA_QUOTA,
  PROFILE_MEDIA_QUOTA_FIELD,
} from '@studenthub/shared-config'
import { Role } from '@studenthub/shared-types'
import {
  DEFAULT_PAGE_LIMIT,
  PROFILE_LIST_LIMITS,
  isPageRequested,
  type AssignAlbumMediaInput,
  type CommentsQueryInput,
  type ConfirmProfileMediaInput,
  type ContentCommentInput,
  type CreateAlbumInput,
  type CreateProfileArticleInput,
  type PresignProfileMediaInput,
  type ProfileArticlesQueryInput,
  type ProfileContentCounts,
  type UpdateAlbumInput,
  type UpdateProfileArticleInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { Paginated } from '../../common/http/paginated'
import { NEWEST_FIRST, encodeKeyset, keysetFrom, olderThan } from '../../common/http/keyset-cursor'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { isFirstViewToday } from '../posts/unique-view'
import { AuditService } from '../../common/audit/audit.service'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { MediaService } from '../media/media.service'
import { MEDIA_FILE_SELECT, type MediaFile, type MediaInfo } from '../media/media.types'
import { PollsService } from '../polls/polls.service'
import {
  PROFILE_CONTENT_OWNER_SELECT,
  UserService,
  type ProfileContentOwner,
} from '../users/users.service'
import {
  CONTENT_AUTHOR_SELECT,
  assertContentModerator,
  isContentModerator,
} from './content-moderation'

// Что принимаем в медиа профиля — из белого списка категорий shared-config, а не по
// префиксу строки: проверка идёт против РЕАЛЬНОГО типа объекта (magic bytes).
const PROFILE_MEDIA_MIMES: ReadonlySet<string> = new Set([
  ...FILE_UPLOAD.ALLOWED_MIME.IMAGE,
  ...FILE_UPLOAD.ALLOWED_MIME.VIDEO,
])
import type { EnvVars } from '../../config/env.schema'

// Плитка статьи в профиле — всё, кроме полного текста (`view=card`, см. listArticles).
const ARTICLE_CARD_SELECT = {
  id: true,
  userId: true,
  title: true,
  description: true,
  coverUrl: true,
  coverGradient: true,
  category: true,
  tags: true,
  visibility: true,
  allowComments: true,
  status: true,
  readingMinutes: true,
  views: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { comments: true, bookmarks: true } },
} satisfies Prisma.ProfileArticleSelect

const ARTICLE_SELECT = {
  ...ARTICLE_CARD_SELECT,
  content: true,
} satisfies Prisma.ProfileArticleSelect

// Сколько комментариев отдаёт прежний ответ без пагинации.
const LEGACY_COMMENTS_LIMIT = 200

const CONTENT_COMMENT_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  authorId: true,
  author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
} satisfies Prisma.ContentCommentSelect

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

// Оценка времени чтения (~200 слов/мин).
function readingMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

/**
 * Медиа профиля. Поля описания медиа (MediaInfo: заглушка, srcset, постер, HLS) — рядом с
 * прежними; бакет публичный, поэтому ссылки вариантов постоянные.
 */
export interface ProfileMediaDto extends MediaInfo {
  id: string
  type: 'PHOTO' | 'VIDEO'
  mime: string
  size: number
  url: string
  posterUrl: string | null
  albumId: string | null
  createdAt: Date
}

// Ширина обложки альбома: плитка сетки, на ретине 640 с запасом.
const ALBUM_COVER_WIDTH = 640

// Поля файла для DTO медиа профиля: варианты собираются тем же запросом.
const PROFILE_MEDIA_SELECT = {
  ...MEDIA_FILE_SELECT,
  key: true,
  size: true,
  albumId: true,
  posterKey: true,
  createdAt: true,
} as const

export interface AlbumDto {
  id: string
  title: string
  coverUrl: string | null
  count: number
  createdAt: Date
}

/**
 * Контент профиля: медиа (фото/видео через File+бакет profile-media), статьи и вопрос-ответ.
 * Просмотр списков — любой аутентифицированный (как публичный профиль). Мутации — только владелец
 * (проверка по actor.sub, IDOR §14.10); удаление чужого — ещё модератор scope
 * (content-moderation.ts), с записью в аудит. Фото/видео — публичный бакет, прямой URL.
 */
@Injectable()
export class ProfileContentService {
  private readonly logger = new Logger(ProfileContentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly users: UserService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly polls: PollsService,
  ) {}

  private get bucket(): string {
    return this.config.get('MINIO_BUCKET_PROFILE_MEDIA', { infer: true })
  }

  private get coversBucket(): string {
    return this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true })
  }

  private assertMediaMime(mime: string): void {
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'В профиль можно загружать только фото и видео',
      )
    }
  }

  // ── Квота медиа (PROFILE_MEDIA_QUOTA) ──────────────────────────────────────

  /** Сколько медиа профиля уже у пользователя: файлов и байт. */
  private async mediaUsage(ownerId: string): Promise<{ files: number; bytes: number }> {
    const agg = await this.prisma.file.aggregate({
      where: { ownerId, bucket: this.bucket },
      _count: { _all: true },
      _sum: { size: true },
    })
    return { files: agg._count._all, bytes: agg._sum.size ?? 0 }
  }

  /** Что из квоты будет превышено, если добавить `add` к `usage`; null — всё влезает. */
  private quotaExceeded(
    usage: { files: number; bytes: number },
    add: { files: number; bytes: number },
  ): 'files' | 'bytes' | null {
    if (usage.files + add.files > PROFILE_MEDIA_QUOTA.MAX_FILES) return 'files'
    if (usage.bytes + add.bytes > PROFILE_MEDIA_QUOTA.MAX_BYTES) return 'bytes'
    return null
  }

  /**
   * 409 с полем квоты в `details`: клиент по нему показывает своё сообщение («удалите
   * лишнее»), а не общее «конфликт». `message` детали — какой предел исчерпан.
   */
  private quotaError(kind: 'files' | 'bytes'): AppException {
    const gb = PROFILE_MEDIA_QUOTA.MAX_BYTES / 1024 ** 3
    return new AppException(
      'CONFLICT',
      kind === 'files'
        ? `В профиле может быть не больше ${PROFILE_MEDIA_QUOTA.MAX_FILES} фото и видео`
        : `Фото и видео профиля могут занимать не больше ${gb} ГБ`,
      [{ field: PROFILE_MEDIA_QUOTA_FIELD, message: kind }],
    )
  }

  /** Проверка «до»: ещё один файл на `bytes` байт влезает в квоту владельца. */
  private async assertMediaQuota(ownerId: string, bytes: number): Promise<void> {
    const over = this.quotaExceeded(await this.mediaUsage(ownerId), { files: 1, bytes })
    if (over) throw this.quotaError(over)
  }

  /**
   * Проверка «после»: файл уже записан и посчитан. Проверка «до» отсекает очевидное, но две
   * параллельные загрузки на последнем месте прошли бы её обе, а при прямой загрузке
   * настоящий размер известен только на подтверждении. Перебор — файл удаляется вместе с
   * объектом. В гонке откатятся обе загрузки (каждая видит перебор) — лучше, чем молча
   * перейти квоту.
   */
  private async rollbackOverQuota(ownerId: string, fileId: string): Promise<void> {
    const over = this.quotaExceeded(await this.mediaUsage(ownerId), { files: 0, bytes: 0 })
    if (!over) return
    await this.files.delete(fileId, ownerId)
    throw this.quotaError(over)
  }

  // ── Медиа (фото/видео) ─────────────────────────────────────────────────────

  /** Загрузка фото/видео в профиль. Тип — по содержимому (magic bytes через FileService). */
  async uploadMedia(actor: JwtPayload, buffer: Buffer): Promise<ProfileMediaDto> {
    // До записи в хранилище: размер буфера известен, и заведомо лишний файл не заливаем.
    await this.assertMediaQuota(actor.sub, buffer.byteLength)
    const file = await this.files.upload({ buffer, bucket: this.bucket, ownerId: actor.sub })
    if (!file.mime.startsWith('image/') && !file.mime.startsWith('video/')) {
      // Разрешаем только изображения и видео — прочее откатываем.
      await this.files.delete(file.id, actor.sub)
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'В профиль можно загружать только фото и видео',
      )
    }
    await this.rollbackOverQuota(actor.sub, file.id)
    this.logger.log(`Медиа профиля ${file.id} загружено пользователем ${actor.sub}`)
    return this.toMediaDto({ ...file, variants: [] })
  }

  /**
   * Медиа профиля пользователя (вкладки Фото/Видео) — по видимости профиля, как и статьи рядом.
   * Раньше отдавалось любому аутентифицированному: закрытый профиль (profileVisibility) скрывал
   * карточку, но фото и видео оставались доступны кому угодно по прямому запросу (§14.7).
   */
  async listMedia(viewer: JwtPayload, userId: string): Promise<ProfileMediaDto[]> {
    if (!(await this.users.canViewProfileContent(viewer, userId))) return []
    const files = await this.prisma.file.findMany({
      where: { ownerId: userId, bucket: this.bucket },
      select: PROFILE_MEDIA_SELECT,
      orderBy: { createdAt: 'desc' },
      take: PROFILE_LIST_LIMITS.media,
    })
    return Promise.all(files.map((f) => this.toMediaDto(f)))
  }

  /**
   * Итоги вкладок профиля (фото, видео, статьи, опросы) глазами смотрящего — по тем же
   * правилам, что и списки. Списки отдаются с потолком (PROFILE_LIST_LIMITS), и их длина
   * у большого профиля — не итог: бейдж показывал бы 300 вместо тысячи. Закрытый для
   * смотрящего или удалённый профиль — нули, как пустые списки.
   */
  async counts(viewer: JwtPayload, userId: string): Promise<ProfileContentCounts> {
    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_CONTENT_OWNER_SELECT,
    })
    if (!author || !(await this.users.canViewProfileContentOf(viewer, author))) {
      return { photos: 0, videos: 0, articles: 0, polls: 0 }
    }
    const media = { ownerId: userId, bucket: this.bucket }
    const [mediaTotal, videos, articles, polls] = await Promise.all([
      this.prisma.file.count({ where: media }),
      // Тип — как в toMediaDto: видео по mime, всё остальное в бакете — фото.
      this.prisma.file.count({ where: { ...media, mime: { startsWith: 'video/' } } }),
      this.prisma.profileArticle.count({
        where: { userId, ...this.viewerVisibilityWhere(viewer, author) },
      }),
      this.polls.countVisibleByUser(viewer, author),
    ])
    return { photos: mediaTotal - videos, videos, articles, polls }
  }

  /**
   * Удаление медиа профиля: своего — владельцем, чужого — модератором scope (тот же путь
   * с объектами в MinIO, плюс запись в аудит). Бакет проверяем всегда: аватар этим
   * эндпоинтом не удалить. Не-модератору чужое медиа по-прежнему «не найдено».
   */
  async deleteMedia(actor: JwtPayload, fileId: string, ctx: RequestContext): Promise<void> {
    const file = await this.files.findOrThrow(fileId)
    const moderated = file.ownerId !== actor.sub
    if (file.bucket !== this.bucket || (moderated && !isContentModerator(actor.role))) {
      throw new AppException('NOT_FOUND', 'Медиа не найдено')
    }
    if (moderated) {
      const author = await this.prisma.user.findUnique({
        where: { id: file.ownerId },
        select: CONTENT_AUTHOR_SELECT,
      })
      if (!author) throw new AppException('NOT_FOUND', 'Медиа не найдено')
      assertContentModerator(actor, author)
    }
    // Удаляем и объект-обложку видео (он без записи File).
    if (file.posterKey) await this.files.removeRawObject(this.coversBucket, file.posterKey)
    // Право на чужой файл проверено выше — FileService владельца уже не сверяет.
    await this.files.delete(fileId, moderated ? undefined : actor.sub)
    if (moderated) {
      await this.recordModeration(actor, ctx, 'profile_media_deleted', 'File', fileId, {
        authorId: file.ownerId,
      })
    }
  }

  /** Presigned PUT для крупных фото/видео (>порога буферной загрузки). Прямая заливка в MinIO. */
  async presignMedia(
    actor: JwtPayload,
    input: PresignProfileMediaInput,
  ): Promise<{ key: string; url: string; expiresAt: string }> {
    // Заявленный MIME отсеивает очевидно неподходящее сразу; окончательная проверка —
    // на подтверждении, по содержимому объекта.
    this.assertMediaMime(input.mime)
    // Квота — по заявленному размеру: не давать ссылку на заливку, которую подтверждение
    // всё равно отклонит. Настоящий размер сверяется на подтверждении.
    await this.assertMediaQuota(actor.sub, input.size)
    return this.files.presignPut(this.bucket, input.mime, actor.sub)
  }

  /**
   * Подтверждение presigned-загрузки: бэкенд сам смотрит объект в MinIO — размер и реальный
   * тип по magic bytes — и создаёт File. MIME из тела запроса больше не используется:
   * при прямой загрузке API не видит байтов, и верить объявленному типу нельзя.
   */
  async confirmMedia(actor: JwtPayload, input: ConfirmProfileMediaInput): Promise<ProfileMediaDto> {
    const file = await this.files.confirmDirectUpload({
      bucket: this.bucket,
      key: input.key,
      ownerId: actor.sub,
      allowedMimes: PROFILE_MEDIA_MIMES,
    })
    // Объект уже в хранилище, и его настоящий размер известен только здесь.
    await this.rollbackOverQuota(actor.sub, file.id)
    this.logger.log(`Медиа профиля ${file.id} подтверждено (presigned) пользователем ${actor.sub}`)
    return this.toMediaDto({ ...file, variants: [] })
  }

  private async toMediaDto(
    file: MediaFile & {
      key: string
      size: number
      createdAt: Date
      albumId?: string | null
      posterKey?: string | null
    },
  ): Promise<ProfileMediaDto> {
    const info = await this.media.describeOne(file)
    // Обложка, выбранная владельцем, важнее кадра, который взял воркер.
    const chosen = file.posterKey ? this.buildPublicUrl(this.coversBucket, file.posterKey) : null
    return {
      ...info,
      id: file.id,
      type: file.mime.startsWith('video/') ? 'VIDEO' : 'PHOTO',
      mime: file.mime,
      size: file.size,
      url: this.buildPublicUrl(file.bucket, file.key),
      posterUrl: chosen ?? info.poster.at(-1)?.url ?? null,
      albumId: file.albumId ?? null,
      createdAt: file.createdAt,
    }
  }

  /** Обложка альбома: миниатюра плитки, если готова, иначе оригинал. */
  private async albumCoverUrl(cover: (MediaFile & { key: string }) | null): Promise<string | null> {
    if (!cover) return null
    const { sources } = await this.media.describeOne(cover)
    const tile = sources.find((s) => s.width >= ALBUM_COVER_WIDTH) ?? sources.at(-1)
    return tile?.url ?? this.buildPublicUrl(cover.bucket, cover.key)
  }

  /** Прикрепить обложку к видео профиля: постер-кадр хранится объектом в бакете profile-covers. */
  async attachPoster(actor: JwtPayload, fileId: string, buffer: Buffer): Promise<ProfileMediaDto> {
    const file = await this.files.findOrThrow(fileId)
    if (
      file.bucket !== this.bucket ||
      file.ownerId !== actor.sub ||
      !file.mime.startsWith('video/')
    ) {
      throw new AppException('NOT_FOUND', 'Видео не найдено')
    }
    // Порядок важен: новая обложка → запись → удаление прежней. Раньше прежнюю сносили
    // первой, и невалидный файл (не картинка, больше лимита) оставлял posterKey на уже
    // удалённый объект — у видео пропадала обложка.
    const posterKey = await this.files.putAuxImage(this.coversBucket, buffer)
    const updated = await this.prisma.file
      .update({ where: { id: fileId }, data: { posterKey }, select: PROFILE_MEDIA_SELECT })
      .catch(async (err: unknown) => {
        // Видео удалили, пока шла загрузка: новая обложка никому не нужна, прежняя — с ним.
        await this.files.removeRawObject(this.coversBucket, posterKey)
        throw err
      })
    if (file.posterKey && file.posterKey !== posterKey) {
      await this.files.removeRawObject(this.coversBucket, file.posterKey)
    }
    return this.toMediaDto(updated)
  }

  // ── Альбомы фото ──────────────────────────────────────────────────────────────

  async createAlbum(actor: JwtPayload, input: CreateAlbumInput): Promise<AlbumDto> {
    const album = await this.prisma.album.create({
      data: { userId: actor.sub, title: input.title },
      select: { id: true, title: true, createdAt: true },
    })
    return { ...album, coverUrl: null, count: 0 }
  }

  /** Альбомы пользователя (с обложкой и числом фото) — по видимости профиля, как и медиа. */
  async listAlbums(viewer: JwtPayload, userId: string): Promise<AlbumDto[]> {
    if (!(await this.users.canViewProfileContent(viewer, userId))) return []
    const albums = await this.prisma.album.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        cover: { select: { ...MEDIA_FILE_SELECT, key: true } },
        _count: { select: { files: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return Promise.all(
      albums.map(async (a) => ({
        id: a.id,
        title: a.title,
        createdAt: a.createdAt,
        count: a._count.files,
        coverUrl: await this.albumCoverUrl(a.cover),
      })),
    )
  }

  async updateAlbum(actor: JwtPayload, id: string, input: UpdateAlbumInput): Promise<AlbumDto> {
    await this.assertAlbumOwner(actor, id)
    // Обложкой может быть только фото из этого альбома (владельца).
    if (input.coverFileId) {
      const file = await this.prisma.file.findFirst({
        where: { id: input.coverFileId, albumId: id, ownerId: actor.sub },
        select: { id: true },
      })
      if (!file) throw new AppException('BAD_REQUEST', 'Обложка должна быть фото из этого альбома')
    }
    const album = await this.prisma.album.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        cover: { select: { ...MEDIA_FILE_SELECT, key: true } },
        _count: { select: { files: true } },
      },
    })
    return {
      id: album.id,
      title: album.title,
      createdAt: album.createdAt,
      count: album._count.files,
      coverUrl: await this.albumCoverUrl(album.cover),
    }
  }

  /** Удаление альбома: фото не удаляются (albumId → null через onDelete SetNull). */
  async deleteAlbum(actor: JwtPayload, id: string): Promise<void> {
    await this.assertAlbumOwner(actor, id)
    await this.prisma.album.delete({ where: { id } })
  }

  /** Привязать свои фото к альбому (перемещение из «без альбома» или другого альбома). */
  async assignAlbumMedia(
    actor: JwtPayload,
    albumId: string,
    input: AssignAlbumMediaInput,
  ): Promise<void> {
    await this.assertAlbumOwner(actor, albumId)
    await this.prisma.file.updateMany({
      where: { id: { in: input.fileIds }, ownerId: actor.sub, bucket: this.bucket },
      data: { albumId },
    })
  }

  /** Убрать фото из альбома (albumId → null). Если это была обложка — снимаем обложку. */
  async removeAlbumMedia(actor: JwtPayload, albumId: string, fileId: string): Promise<void> {
    await this.assertAlbumOwner(actor, albumId)
    await this.prisma.file.updateMany({
      where: { id: fileId, albumId, ownerId: actor.sub },
      data: { albumId: null },
    })
    await this.prisma.album.updateMany({
      where: { id: albumId, coverFileId: fileId },
      data: { coverFileId: null },
    })
  }

  private async assertAlbumOwner(actor: JwtPayload, id: string): Promise<void> {
    const a = await this.prisma.album.findUnique({ where: { id }, select: { userId: true } })
    if (!a) throw new AppException('NOT_FOUND', 'Альбом не найден')
    if (a.userId !== actor.sub)
      throw new AppException('FORBIDDEN', 'Можно менять только свои альбомы')
  }

  // ── Статьи ──────────────────────────────────────────────────────────────────

  /** Загрузка обложки статьи (изображение) в бакет profile-covers → публичный URL. */
  async uploadCover(actor: JwtPayload, buffer: Buffer): Promise<{ url: string }> {
    const file = await this.files.upload({
      buffer,
      bucket: this.coversBucket,
      ownerId: actor.sub,
      expectedCategory: 'IMAGE',
    })
    return { url: this.buildPublicUrl(this.coversBucket, file.key) }
  }

  /**
   * Обложка — только файл платформы: загруженный через POST /profile/articles/cover или из
   * медиа профиля (так обложки берёт сид). Произвольная строка показывалась бы картинкой
   * каждому читателю и работала как трекинг-пиксель с чужого сервера.
   */
  private coverUrlOrThrow(url: string | undefined): string | null {
    if (!url) return null
    const own = [this.coversBucket, this.bucket].map((b) => this.buildPublicUrl(b, ''))
    if (!own.some((prefix) => url.startsWith(prefix))) {
      throw new AppException('BAD_REQUEST', 'Обложку нужно загрузить на платформу')
    }
    return url
  }

  private articleData(input: CreateProfileArticleInput) {
    return {
      title: input.title,
      description: input.description ?? null,
      content: input.content,
      coverUrl: this.coverUrlOrThrow(input.coverUrl),
      coverGradient: input.coverGradient ? input.coverGradient : null,
      category: input.category ?? null,
      tags: input.tags ?? [],
      visibility: input.visibility,
      allowComments: input.allowComments,
      status: input.status,
      readingMinutes: readingMinutes(input.content),
    }
  }

  async createArticle(actor: JwtPayload, input: CreateProfileArticleInput) {
    const row = await this.prisma.profileArticle.create({
      data: {
        userId: actor.sub,
        ...this.articleData(input),
        // Момент первой публикации фиксируем при создании со статусом PUBLISHED.
        publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
      },
      select: ARTICLE_SELECT,
    })
    return (await this.decorateArticles([row], actor.sub))[0]
  }

  // Добавляет к статьям число комментариев/закладок и флаг «в закладках у смотрящего»;
  // прячет сырой _count.
  private async decorateArticles<
    T extends { id: string; _count: { comments: number; bookmarks: number } },
  >(
    rows: T[],
    viewerId: string,
  ): Promise<
    (Omit<T, '_count'> & { commentCount: number; bookmarksCount: number; bookmarked: boolean })[]
  > {
    const ids = rows.map((r) => r.id)
    const marks = ids.length
      ? await this.prisma.bookmark.findMany({
          take: ids.length,
          where: { userId: viewerId, articleId: { in: ids } },
          select: { articleId: true },
        })
      : []
    const marked = new Set(marks.map((m) => m.articleId))
    return rows.map(({ _count, ...rest }) => ({
      ...(rest as Omit<T, '_count'>),
      commentCount: _count.comments,
      bookmarksCount: _count.bookmarks,
      bookmarked: marked.has(rest.id as string),
    }))
  }

  /**
   * Статьи пользователя, видимые смотрящему: черновики — только автору; visibility по scope.
   * Первым шагом — видимость профиля, как у медиа и альбомов: закрытый профиль скрывает и
   * статьи. Раньше статья с видимостью ALL отдавалась по прямому запросу кому угодно, хотя
   * «визитка» владельца была закрыта (§14.7). Статьи удалённого аккаунта не отдаются.
   *
   * `view=card` — без полного текста: плитке и бейджу вкладки он не нужен, а сотня статей до
   * 20 000 символов превращала открытие профиля в мегабайты. Текст — `getArticle`. Без
   * параметра — как раньше, с текстом (его ждут уже выпущенные клиенты).
   */
  async listArticles(
    viewer: JwtPayload,
    targetUserId: string,
    query: ProfileArticlesQueryInput = {},
  ) {
    const author = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: PROFILE_CONTENT_OWNER_SELECT,
    })
    if (!author || !(await this.users.canViewProfileContentOf(viewer, author))) return []
    const where = { userId: targetUserId, ...this.viewerVisibilityWhere(viewer, author) }
    const order = { createdAt: 'desc' } as const
    if (query.view === 'card') {
      const cards = await this.prisma.profileArticle.findMany({
        where,
        select: ARTICLE_CARD_SELECT,
        orderBy: order,
        take: PROFILE_LIST_LIMITS.articles,
      })
      return this.decorateArticles(cards, viewer.sub)
    }
    const rows = await this.prisma.profileArticle.findMany({
      where,
      select: ARTICLE_SELECT,
      orderBy: order,
      take: PROFILE_LIST_LIMITS.articles,
    })
    return this.decorateArticles(rows, viewer.sub)
  }

  /**
   * Статья целиком — для читалки и редактора, которые раньше брали текст из списка.
   * Права те же, что у списка: черновик — только автору, visibility и закрытый профиль —
   * как у остального контента; невидимая статья — «не найдена».
   */
  async getArticle(viewer: JwtPayload, id: string) {
    await this.assertArticleVisible(viewer, id)
    const row = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: ARTICLE_SELECT,
    })
    if (!row) throw new AppException('NOT_FOUND', 'Статья не найдена')
    return (await this.decorateArticles([row], viewer.sub))[0]
  }

  async updateArticle(actor: JwtPayload, id: string, input: UpdateProfileArticleInput) {
    const cur = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: { userId: true, publishedAt: true },
    })
    if (!cur) throw new AppException('NOT_FOUND', 'Статья не найдена')
    if (cur.userId !== actor.sub)
      throw new AppException('FORBIDDEN', 'Можно менять только свои статьи')
    // publishedAt проставляем при первом переходе в PUBLISHED; далее — сохраняем.
    const publishedAt =
      input.status === 'PUBLISHED' ? (cur.publishedAt ?? new Date()) : cur.publishedAt
    const row = await this.prisma.profileArticle.update({
      where: { id },
      data: { ...this.articleData(input), publishedAt },
      select: ARTICLE_SELECT,
    })
    return (await this.decorateArticles([row], actor.sub))[0]
  }

  /** Удаление статьи: своей — владельцем, чужой — модератором scope (с записью в аудит). */
  async deleteArticle(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: { userId: true, user: { select: CONTENT_AUTHOR_SELECT } },
    })
    if (!row) throw new AppException('NOT_FOUND', 'Статья не найдена')
    const moderated = row.userId !== actor.sub
    if (moderated) {
      if (!isContentModerator(actor.role)) {
        throw new AppException('FORBIDDEN', 'Можно менять только свои статьи')
      }
      assertContentModerator(actor, row.user)
    }
    await this.prisma.profileArticle.delete({ where: { id } })
    if (moderated) {
      await this.recordModeration(actor, ctx, 'profile_article_deleted', 'ProfileArticle', id, {
        authorId: row.userId,
      })
    }
  }

  /**
   * Просмотр статьи (при открытии читалки). Только если статья видна смотрящему.
   * Засчитывается один раз в сутки на зрителя (posts/unique-view.ts) — повторное открытие
   * отвечает текущим числом без записи в строку статьи.
   */
  async incrementArticleView(viewer: JwtPayload, id: string): Promise<{ views: number }> {
    await this.assertArticleVisible(viewer, id)
    if (!(await isFirstViewToday(this.redis, 'article', id, viewer.sub))) {
      const current = await this.prisma.profileArticle.findUnique({
        where: { id },
        select: { views: true },
      })
      return { views: current?.views ?? 0 }
    }
    const updated = await this.prisma.profileArticle.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { views: true },
    })
    return updated
  }

  /** Похожие статьи ТОГО ЖЕ автора: та же категория или пересечение тегов; опубликованные, видимые. */
  async relatedArticles(viewer: JwtPayload, id: string) {
    const base = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: {
        userId: true,
        category: true,
        tags: true,
        user: { select: PROFILE_CONTENT_OWNER_SELECT },
      },
    })
    if (!base) return []
    const similar: Prisma.ProfileArticleWhereInput[] = []
    if (base.category) similar.push({ category: base.category })
    if (base.tags.length > 0) similar.push({ tags: { hasSome: base.tags } })
    if (similar.length === 0) return []
    if (!(await this.users.canViewProfileContentOf(viewer, base.user))) return []

    const where: Prisma.ProfileArticleWhereInput = {
      userId: base.userId,
      id: { not: id },
      OR: similar,
      ...this.viewerVisibilityWhere(viewer, base.user),
    }
    const rows = await this.prisma.profileArticle.findMany({
      where,
      select: ARTICLE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 4,
    })
    return this.decorateArticles(rows, viewer.sub)
  }

  // Ограничение видимости для чужого смотрящего (черновики скрыты, visibility по scope). Для
  // владельца/платформы — пусто (видно всё). Общая логика для listArticles/related. Закрытый
  // профиль решает users.canViewProfileContentOf — до этого фильтра.
  private viewerVisibilityWhere(
    viewer: JwtPayload,
    author: ProfileContentOwner,
  ): Prisma.ProfileArticleWhereInput {
    if (viewer.sub === author.id || isPlatform(viewer.role)) return {}
    const vis = ['ALL']
    if (author.universityId && viewer.universityId === author.universityId) vis.push('UNIVERSITY')
    if (author.facultyId && viewer.facultyId === author.facultyId) vis.push('FACULTY')
    if (author.groupId && viewer.groupId === author.groupId) vis.push('GROUP')
    return { status: 'PUBLISHED', visibility: { in: vis } }
  }

  // Статус и видимость самой статьи — та же логика, что viewerVisibilityWhere, для одной строки.
  private articleScopeOk(
    viewer: JwtPayload,
    a: { userId: string; status: string; visibility: string },
    author: ProfileContentOwner,
  ): boolean {
    if (viewer.sub === a.userId || isPlatform(viewer.role)) return true
    if (a.status !== 'PUBLISHED') return false
    return (
      a.visibility === 'ALL' ||
      (a.visibility === 'UNIVERSITY' &&
        !!author.universityId &&
        viewer.universityId === author.universityId) ||
      (a.visibility === 'FACULTY' && !!author.facultyId && viewer.facultyId === author.facultyId) ||
      (a.visibility === 'GROUP' && !!author.groupId && viewer.groupId === author.groupId)
    )
  }

  /**
   * Статья видна смотрящему: и сама (статус, visibility), и профиль автора (закрытый профиль,
   * удалённый аккаунт). Общая точка для читалки, просмотров, комментариев и закладок.
   */
  private async assertArticleVisible(viewer: JwtPayload, id: string): Promise<void> {
    const a = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: {
        userId: true,
        status: true,
        visibility: true,
        user: { select: PROFILE_CONTENT_OWNER_SELECT },
      },
    })
    if (
      !a ||
      !this.articleScopeOk(viewer, a, a.user) ||
      !(await this.users.canViewProfileContentOf(viewer, a.user))
    ) {
      throw new AppException('NOT_FOUND', 'Статья не найдена')
    }
  }

  // ── Комментарии к статьям ──────────────────────────────────────────────────────

  /**
   * Комментарии статьи. Без `limit`/`cursor` — прежний массив по порядку написания, но
   * ПОСЛЕДНИЕ двести, а не первые: в длинном обсуждении новый комментарий пропадал после
   * перезагрузки. С ними — страница свежих сверху, `meta.total` — сколько всего.
   */
  async listArticleComments(viewer: JwtPayload, articleId: string, query: CommentsQueryInput = {}) {
    await this.assertArticleVisible(viewer, articleId)
    const where: Prisma.ContentCommentWhereInput = { articleId }
    if (!isPageRequested(query)) {
      const rows = await this.prisma.contentComment.findMany({
        where,
        select: CONTENT_COMMENT_SELECT,
        orderBy: NEWEST_FIRST,
        take: LEGACY_COMMENTS_LIMIT,
      })
      return rows.reverse()
    }
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT
    // Курсор несёт момент и id (keyset-cursor.ts): комментарий статьи стирается навсегда, и
    // Prisma-курсор на стёртую строку обрывал бы листание.
    const after = query.cursor
      ? await keysetFrom(query.cursor, (cursorId) =>
          this.prisma.contentComment.findUnique({
            where: { id: cursorId },
            select: { createdAt: true, id: true },
          }),
        )
      : null
    const total = await this.prisma.contentComment.count({ where })
    if (query.cursor && !after) return new Paginated([], { hasNext: false, total })
    const rows = await this.prisma.contentComment.findMany({
      where: after ? { AND: [where, olderThan(after)] } : where,
      select: CONTENT_COMMENT_SELECT,
      orderBy: NEWEST_FIRST,
      take: limit + 1,
    })
    const hasNext = rows.length > limit
    const page = hasNext ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    return new Paginated(page, {
      cursor: hasNext && last ? encodeKeyset(last) : undefined,
      hasNext,
      total,
    })
  }

  async addArticleComment(viewer: JwtPayload, articleId: string, input: ContentCommentInput) {
    await this.assertArticleVisible(viewer, articleId)
    const article = await this.prisma.profileArticle.findUnique({
      where: { id: articleId },
      select: { allowComments: true, userId: true },
    })
    if (!article?.allowComments)
      throw new AppException('FORBIDDEN', 'Комментарии к статье отключены')
    const created = await this.prisma.contentComment.create({
      data: { authorId: viewer.sub, articleId, content: input.content },
      select: CONTENT_COMMENT_SELECT,
    })
    await this.notifyArticleOwner(viewer, { id: articleId, userId: article.userId }, created)
    return created
  }

  /**
   * Автору статьи — о новом комментарии: одна свёрнутая строка на статью в колокольчике, а не
   * строка на каждую реплику. Свой комментарий и личная блокировка в любую сторону — без
   * уведомления. Комментарий уже сохранён — сбой здесь не превращает его в ошибку.
   */
  private async notifyArticleOwner(
    actor: JwtPayload,
    article: { id: string; userId: string },
    comment: { id: string; author: { firstName: string; lastName: string } },
  ): Promise<void> {
    if (article.userId === actor.sub) return
    try {
      const blocked = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: actor.sub, blockedId: article.userId },
            { blockerId: article.userId, blockedId: actor.sub },
          ],
        },
        select: { id: true },
      })
      if (blocked) return
      const dedupeKey = `article-comment:${comment.id}`
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        NOTIFICATION_JOBS.COMMENT_ADDED,
        {
          recipientIds: [article.userId],
          type: 'POST',
          titleKey: 'comments.new.title',
          bodyKey: 'comments.article.body',
          params: { name: `${comment.author.firstName} ${comment.author.lastName}`.trim() },
          data: { articleId: article.id, commentId: comment.id, url: `/profile/${article.userId}` },
          dedupeKey,
          collapseKey: `article-comments:${article.id}`,
        },
        { jobId: dedupeKey },
      )
    } catch (error) {
      this.logger.warn(
        { err: error, articleId: article.id },
        'Уведомление о комментарии не поставлено',
      )
    }
  }

  async deleteArticleComment(
    viewer: JwtPayload,
    articleId: string,
    commentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const c = await this.prisma.contentComment.findUnique({
      where: { id: commentId },
      select: {
        authorId: true,
        articleId: true,
        author: { select: CONTENT_AUTHOR_SELECT },
        article: { select: { userId: true, user: { select: CONTENT_AUTHOR_SELECT } } },
      },
    })
    if (!c || c.articleId !== articleId)
      throw new AppException('NOT_FOUND', 'Комментарий не найден')
    // Удалить может автор комментария, владелец статьи или модератор scope (с записью в аудит).
    const moderated = c.authorId !== viewer.sub && c.article?.userId !== viewer.sub
    if (moderated) {
      if (!isContentModerator(viewer.role)) {
        throw new AppException('FORBIDDEN', 'Нет прав на удаление')
      }
      assertContentModerator(viewer, c.author, c.article?.user)
    }
    await this.prisma.contentComment.delete({ where: { id: commentId } })
    if (moderated) {
      await this.recordModeration(
        viewer,
        ctx,
        'content_comment_deleted',
        'ContentComment',
        commentId,
        { articleId, authorId: c.authorId },
      )
    }
  }

  // ── Закладки на статьи ─────────────────────────────────────────────────────────

  /**
   * Переключатель закладки без чтения перед записью — как у постов: при двойном нажатии
   * «найти → создать» пускало оба запроса в create, и второй отвечал 409/500 уникальностью.
   * Удаление само говорит, была ли закладка; гонку двух create решает уникальный индекс.
   */
  async toggleBookmark(viewer: JwtPayload, articleId: string): Promise<{ bookmarked: boolean }> {
    await this.assertArticleVisible(viewer, articleId)
    const removed = await this.prisma.bookmark.deleteMany({
      where: { userId: viewer.sub, articleId },
    })
    if (removed.count > 0) return { bookmarked: false }
    try {
      await this.prisma.bookmark.create({ data: { userId: viewer.sub, articleId } })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error
      }
    }
    return { bookmarked: true }
  }

  /**
   * Мои закладки — только статьи, видимые сейчас: автор мог закрыть профиль, снять статью в
   * черновик, сузить видимость или удалить аккаунт, а закладка на это не смотрела и продолжала
   * отдавать полный текст. Видимость профилей авторов проверяется пачкой, не по статье.
   */
  async listBookmarks(viewer: JwtPayload) {
    const marks = await this.prisma.bookmark.findMany({
      where: { userId: viewer.sub },
      select: {
        article: { select: { ...ARTICLE_SELECT, user: { select: PROFILE_CONTENT_OWNER_SELECT } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const viewable = await this.users.viewableProfileContentOwners(
      viewer,
      marks.map((m) => m.article.user),
    )
    const visible = marks
      .map((m) => m.article)
      .filter((a) => viewable.has(a.userId) && this.articleScopeOk(viewer, a, a.user))
      // Поля автора нужны только для проверки — наружу уходит прежняя форма статьи.
      .map(({ user, ...article }) => article)
    return this.decorateArticles(visible, viewer.sub)
  }

  // ── util ─────────────────────────────────────────────────────────────────────

  /** Чужой контент снят модератором — решение модератора пишется в аудит (BACKEND_RULES §13). */
  private async recordModeration(
    actor: JwtPayload,
    ctx: RequestContext,
    action: string,
    entity: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`${entity} ${entityId} снят модератором ${actor.sub}`)
    await this.audit.record({ userId: actor.sub, action, entity, entityId, metadata, ...ctx })
  }

  private buildPublicUrl(bucket: string, key: string): string {
    return buildPublicObjectUrl(this.config, bucket, key)
  }
}
