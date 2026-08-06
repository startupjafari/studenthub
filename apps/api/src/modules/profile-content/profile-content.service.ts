import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { Role } from '@studenthub/shared-types'
import type {
  AssignAlbumMediaInput,
  ConfirmProfileMediaInput,
  ContentCommentInput,
  CreateAlbumInput,
  CreateProfileArticleInput,
  PresignProfileMediaInput,
  UpdateAlbumInput,
  UpdateProfileArticleInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { FileService } from '../files/file.service'
import type { EnvVars } from '../../config/env.schema'

const ARTICLE_SELECT = {
  id: true,
  userId: true,
  title: true,
  description: true,
  content: true,
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

export interface ProfileMediaDto {
  id: string
  type: 'PHOTO' | 'VIDEO'
  mime: string
  size: number
  url: string
  posterUrl: string | null
  albumId: string | null
  createdAt: Date
}

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
 * (проверка по actor.sub, IDOR §14.10). Фото/видео — публичный бакет, прямой URL.
 */
@Injectable()
export class ProfileContentService {
  private readonly logger = new Logger(ProfileContentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
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

  // ── Медиа (фото/видео) ─────────────────────────────────────────────────────

  /** Загрузка фото/видео в профиль. Тип — по содержимому (magic bytes через FileService). */
  async uploadMedia(actor: JwtPayload, buffer: Buffer): Promise<ProfileMediaDto> {
    const file = await this.files.upload({ buffer, bucket: this.bucket, ownerId: actor.sub })
    if (!file.mime.startsWith('image/') && !file.mime.startsWith('video/')) {
      // Разрешаем только изображения и видео — прочее откатываем.
      await this.files.delete(file.id, actor.sub)
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'В профиль можно загружать только фото и видео',
      )
    }
    this.logger.log(`Медиа профиля ${file.id} загружено пользователем ${actor.sub}`)
    return this.toMediaDto(file)
  }

  /** Медиа профиля пользователя (для вкладок Фото/Видео). Видит любой аутентифицированный. */
  async listMedia(userId: string): Promise<ProfileMediaDto[]> {
    const files = await this.prisma.file.findMany({
      where: { ownerId: userId, bucket: this.bucket },
      select: {
        id: true,
        bucket: true,
        key: true,
        mime: true,
        size: true,
        albumId: true,
        posterKey: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
    return files.map((f) => this.toMediaDto(f))
  }

  /** Удаление своего медиа. Проверяем и владение, и бакет (нельзя удалить аватар этим эндпоинтом). */
  async deleteMedia(actor: JwtPayload, fileId: string): Promise<void> {
    const file = await this.files.findOrThrow(fileId)
    if (file.bucket !== this.bucket || file.ownerId !== actor.sub) {
      throw new AppException('NOT_FOUND', 'Медиа не найдено')
    }
    // Удаляем и объект-обложку видео (он без записи File).
    if (file.posterKey) await this.files.removeRawObject(this.coversBucket, file.posterKey)
    await this.files.delete(fileId, actor.sub)
  }

  /** Presigned PUT для крупных фото/видео (>порога буферной загрузки). Прямая заливка в MinIO. */
  async presignMedia(
    _actor: JwtPayload,
    input: PresignProfileMediaInput,
  ): Promise<{ key: string; url: string }> {
    this.assertMediaMime(input.mime)
    return this.files.presignPut(this.bucket, input.mime)
  }

  /** Подтверждение presigned-загрузки: бэкенд проверяет объект (stat) и создаёт File. */
  async confirmMedia(actor: JwtPayload, input: ConfirmProfileMediaInput): Promise<ProfileMediaDto> {
    this.assertMediaMime(input.mime)
    const file = await this.files.confirmDirectUpload({
      bucket: this.bucket,
      key: input.key,
      ownerId: actor.sub,
      mime: input.mime,
      maxBytes: FILE_UPLOAD.MAX_BYTES.VIDEO,
    })
    this.logger.log(`Медиа профиля ${file.id} подтверждено (presigned) пользователем ${actor.sub}`)
    return this.toMediaDto(file)
  }

  private toMediaDto(file: {
    id: string
    bucket: string
    key: string
    mime: string
    size: number
    createdAt: Date
    albumId?: string | null
    posterKey?: string | null
  }): ProfileMediaDto {
    return {
      id: file.id,
      type: file.mime.startsWith('video/') ? 'VIDEO' : 'PHOTO',
      mime: file.mime,
      size: file.size,
      url: this.buildPublicUrl(file.bucket, file.key),
      posterUrl: file.posterKey ? this.buildPublicUrl(this.coversBucket, file.posterKey) : null,
      albumId: file.albumId ?? null,
      createdAt: file.createdAt,
    }
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
    if (file.posterKey) await this.files.removeRawObject(this.coversBucket, file.posterKey)
    const posterKey = await this.files.putAuxImage(this.coversBucket, buffer)
    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: { posterKey },
      select: {
        id: true,
        bucket: true,
        key: true,
        mime: true,
        size: true,
        albumId: true,
        posterKey: true,
        createdAt: true,
      },
    })
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

  /** Альбомы пользователя (с обложкой и числом фото). Видит любой аутентифицированный. */
  async listAlbums(userId: string): Promise<AlbumDto[]> {
    const albums = await this.prisma.album.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        cover: { select: { bucket: true, key: true } },
        _count: { select: { files: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return albums.map((a) => ({
      id: a.id,
      title: a.title,
      createdAt: a.createdAt,
      count: a._count.files,
      coverUrl: a.cover ? this.buildPublicUrl(a.cover.bucket, a.cover.key) : null,
    }))
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
        cover: { select: { bucket: true, key: true } },
        _count: { select: { files: true } },
      },
    })
    return {
      id: album.id,
      title: album.title,
      createdAt: album.createdAt,
      count: album._count.files,
      coverUrl: album.cover ? this.buildPublicUrl(album.cover.bucket, album.cover.key) : null,
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

  private articleData(input: CreateProfileArticleInput) {
    return {
      title: input.title,
      description: input.description ?? null,
      content: input.content,
      coverUrl: input.coverUrl ? input.coverUrl : null,
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

  /** Статьи пользователя, видимые смотрящему: черновики — только автору; visibility по scope. */
  async listArticles(viewer: JwtPayload, targetUserId: string) {
    const author = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { universityId: true, facultyId: true, groupId: true },
    })
    if (!author) return []
    const where: Prisma.ProfileArticleWhereInput = { userId: targetUserId }
    if (viewer.sub !== targetUserId && !isPlatform(viewer.role)) {
      where.status = 'PUBLISHED'
      const vis = ['ALL']
      if (author.universityId && viewer.universityId === author.universityId) vis.push('UNIVERSITY')
      if (author.facultyId && viewer.facultyId === author.facultyId) vis.push('FACULTY')
      if (author.groupId && viewer.groupId === author.groupId) vis.push('GROUP')
      where.visibility = { in: vis }
    }
    const rows = await this.prisma.profileArticle.findMany({
      where,
      select: ARTICLE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return this.decorateArticles(rows, viewer.sub)
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

  async deleteArticle(actor: JwtPayload, id: string): Promise<void> {
    await this.assertArticleOwner(actor, id)
    await this.prisma.profileArticle.delete({ where: { id } })
  }

  /** Инкремент просмотров статьи (при открытии читалки). Только если статья видна смотрящему. */
  async incrementArticleView(viewer: JwtPayload, id: string): Promise<{ views: number }> {
    await this.assertArticleVisible(viewer, id)
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
      select: { userId: true, category: true, tags: true },
    })
    if (!base) return []
    const similar: Prisma.ProfileArticleWhereInput[] = []
    if (base.category) similar.push({ category: base.category })
    if (base.tags.length > 0) similar.push({ tags: { hasSome: base.tags } })
    if (similar.length === 0) return []

    const where: Prisma.ProfileArticleWhereInput = {
      userId: base.userId,
      id: { not: id },
      OR: similar,
      ...(await this.viewerVisibilityWhere(viewer, base.userId)),
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
  // владельца/платформы — пусто (видно всё). Общая логика для listArticles/related.
  private async viewerVisibilityWhere(
    viewer: JwtPayload,
    authorId: string,
  ): Promise<Prisma.ProfileArticleWhereInput> {
    if (viewer.sub === authorId || isPlatform(viewer.role)) return {}
    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { universityId: true, facultyId: true, groupId: true },
    })
    const vis = ['ALL']
    if (author?.universityId && viewer.universityId === author.universityId) vis.push('UNIVERSITY')
    if (author?.facultyId && viewer.facultyId === author.facultyId) vis.push('FACULTY')
    if (author?.groupId && viewer.groupId === author.groupId) vis.push('GROUP')
    return { status: 'PUBLISHED', visibility: { in: vis } }
  }

  private async assertArticleVisible(viewer: JwtPayload, id: string): Promise<void> {
    const a = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: {
        userId: true,
        status: true,
        visibility: true,
        user: { select: { universityId: true, facultyId: true, groupId: true } },
      },
    })
    if (!a) throw new AppException('NOT_FOUND', 'Статья не найдена')
    if (viewer.sub === a.userId || isPlatform(viewer.role)) return
    const scopeOk =
      a.visibility === 'ALL' ||
      (a.visibility === 'UNIVERSITY' &&
        !!a.user.universityId &&
        viewer.universityId === a.user.universityId) ||
      (a.visibility === 'FACULTY' && !!a.user.facultyId && viewer.facultyId === a.user.facultyId) ||
      (a.visibility === 'GROUP' && !!a.user.groupId && viewer.groupId === a.user.groupId)
    if (a.status !== 'PUBLISHED' || !scopeOk)
      throw new AppException('NOT_FOUND', 'Статья не найдена')
  }

  private async assertArticleOwner(actor: JwtPayload, id: string): Promise<void> {
    const row = await this.prisma.profileArticle.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!row) throw new AppException('NOT_FOUND', 'Статья не найдена')
    if (row.userId !== actor.sub)
      throw new AppException('FORBIDDEN', 'Можно менять только свои статьи')
  }

  // ── Комментарии к статьям ──────────────────────────────────────────────────────

  async listArticleComments(viewer: JwtPayload, articleId: string) {
    await this.assertArticleVisible(viewer, articleId)
    return this.prisma.contentComment.findMany({
      where: { articleId },
      select: CONTENT_COMMENT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  }

  async addArticleComment(viewer: JwtPayload, articleId: string, input: ContentCommentInput) {
    await this.assertArticleVisible(viewer, articleId)
    const article = await this.prisma.profileArticle.findUnique({
      where: { id: articleId },
      select: { allowComments: true },
    })
    if (!article?.allowComments)
      throw new AppException('FORBIDDEN', 'Комментарии к статье отключены')
    return this.prisma.contentComment.create({
      data: { authorId: viewer.sub, articleId, content: input.content },
      select: CONTENT_COMMENT_SELECT,
    })
  }

  async deleteArticleComment(
    viewer: JwtPayload,
    articleId: string,
    commentId: string,
  ): Promise<void> {
    const c = await this.prisma.contentComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, articleId: true, article: { select: { userId: true } } },
    })
    if (!c || c.articleId !== articleId)
      throw new AppException('NOT_FOUND', 'Комментарий не найден')
    // Удалить может автор комментария или владелец статьи.
    if (c.authorId !== viewer.sub && c.article?.userId !== viewer.sub) {
      throw new AppException('FORBIDDEN', 'Нет прав на удаление')
    }
    await this.prisma.contentComment.delete({ where: { id: commentId } })
  }

  // ── Закладки на статьи ─────────────────────────────────────────────────────────

  async toggleBookmark(viewer: JwtPayload, articleId: string): Promise<{ bookmarked: boolean }> {
    await this.assertArticleVisible(viewer, articleId)
    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_articleId: { userId: viewer.sub, articleId } },
      select: { id: true },
    })
    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } })
      return { bookmarked: false }
    }
    await this.prisma.bookmark.create({ data: { userId: viewer.sub, articleId } })
    return { bookmarked: true }
  }

  async listBookmarks(viewer: JwtPayload) {
    const marks = await this.prisma.bookmark.findMany({
      where: { userId: viewer.sub },
      select: { article: { select: ARTICLE_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return this.decorateArticles(
      marks.map((m) => m.article),
      viewer.sub,
    )
  }

  // ── util ─────────────────────────────────────────────────────────────────────

  private buildPublicUrl(bucket: string, key: string): string {
    const scheme = this.config.get('MINIO_USE_SSL', { infer: true }) ? 'https' : 'http'
    const endpoint = this.config.get('MINIO_ENDPOINT', { infer: true })
    const port = this.config.get('MINIO_PORT', { infer: true })
    return `${scheme}://${endpoint}:${port}/${bucket}/${key}`
  }
}
