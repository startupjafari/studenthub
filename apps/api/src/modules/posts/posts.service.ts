import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PostAudience, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreateCommentInput,
  CreatePostInput,
  FeedFilterValue,
  FeedQueryInput,
  ReactionInput,
  RepostInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileService } from '../files/file.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import type { EnvVars } from '../../config/env.schema'

// Иерархия ролей для закрепления (задача 8.6): закрепить может только роль СТРОГО выше автора.
const ROLE_RANK: Record<Role, number> = {
  [Role.STUDENT]: 0,
  [Role.STAROSTA]: 1,
  [Role.TEACHER]: 2,
  [Role.DEAN]: 3,
  [Role.UNIVERSITY_MODERATOR]: 4,
  [Role.UNIVERSITY_ADMIN]: 5,
  [Role.PLATFORM_MODERATOR]: 6,
  [Role.PLATFORM_ADMIN]: 7,
}

// Разрешённые аудитории по роли автора (docs/PROJECT.md §2.2 — модераторы посты не создают).
const ALLOWED_AUDIENCES: Record<Role, PostAudience[]> = {
  [Role.PLATFORM_ADMIN]: [PostAudience.ALL, PostAudience.PERSONAL],
  [Role.PLATFORM_MODERATOR]: [],
  [Role.UNIVERSITY_ADMIN]: [
    PostAudience.UNIVERSITY,
    PostAudience.FACULTY,
    PostAudience.GROUP,
    PostAudience.TEACHERS,
    PostAudience.PERSONAL,
  ],
  [Role.UNIVERSITY_MODERATOR]: [],
  [Role.DEAN]: [PostAudience.FACULTY, PostAudience.GROUP, PostAudience.PERSONAL],
  [Role.TEACHER]: [PostAudience.GROUP, PostAudience.SUBJECT, PostAudience.PERSONAL],
  [Role.STAROSTA]: [PostAudience.GROUP, PostAudience.PERSONAL],
  [Role.STUDENT]: [PostAudience.GROUP, PostAudience.PERSONAL],
}

// Базовый приоритет в ленте по аудитории (docs/PROJECT.md §3.3).
const AUDIENCE_PRIORITY: Record<PostAudience, number> = {
  [PostAudience.ALL]: 50,
  [PostAudience.UNIVERSITY]: 40,
  [PostAudience.FACULTY]: 35,
  [PostAudience.TEACHERS]: 32,
  [PostAudience.GROUP]: 30,
  [PostAudience.SUBJECT]: 25,
  [PostAudience.PERSONAL]: 20,
}

const AUTHOR_SELECT = {
  select: { id: true, firstName: true, lastName: true, role: true, avatarUrl: true },
}

const POST_SELECT = {
  id: true,
  audience: true,
  content: true,
  authorId: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  targetUserId: true,
  subject: true,
  priority: true,
  pinnedAt: true,
  originalPostId: true,
  views: true,
  status: true,
  scheduledAt: true,
  publishedAt: true,
  createdAt: true,
  author: AUTHOR_SELECT,
  media: { select: { id: true, mime: true } },
  reactions: { select: { emoji: true, userId: true } },
  original: {
    select: { id: true, content: true, author: AUTHOR_SELECT },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.PostSelect

type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>

// Поля scope для проверки прав (без тяжёлых relation'ов).
const POST_SCOPE_SELECT = {
  id: true,
  authorId: true,
  audience: true,
  universityId: true,
  facultyId: true,
  groupId: true,
} satisfies Prisma.PostSelect

const COMMENT_SELECT = {
  id: true,
  postId: true,
  parentId: true,
  content: true,
  createdAt: true,
  author: AUTHOR_SELECT,
} satisfies Prisma.CommentSelect

// Scope-цель поста, вычисленная из audience (проставляется в data при создании).
interface PostTarget {
  universityId?: string
  facultyId?: string
  groupId?: string
  targetUserId?: string
  subject?: string
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly files: FileService,
  ) {}

  // ── Видимость (задача 8.2) ──────────────────────────────────────────────────

  /**
   * Пользователь видит: ALL + свои посты + свой вуз (UNIVERSITY/SUBJECT/TEACHERS-для-препода)
   * + свой факультет + свою группу + адресованное лично (docs/PROJECT.md §3.3).
   */
  private visibilityWhere(viewer: JwtPayload): Prisma.PostWhereInput {
    const or: Prisma.PostWhereInput[] = [
      { audience: PostAudience.ALL },
      { authorId: viewer.sub },
      { audience: PostAudience.PERSONAL, targetUserId: viewer.sub },
    ]
    if (viewer.universityId) {
      or.push({ audience: PostAudience.UNIVERSITY, universityId: viewer.universityId })
      or.push({ audience: PostAudience.SUBJECT, universityId: viewer.universityId })
      if (viewer.role === Role.TEACHER) {
        or.push({ audience: PostAudience.TEACHERS, universityId: viewer.universityId })
      }
    }
    if (viewer.facultyId) {
      or.push({ audience: PostAudience.FACULTY, facultyId: viewer.facultyId })
    }
    if (viewer.groupId) {
      or.push({ audience: PostAudience.GROUP, groupId: viewer.groupId })
    }
    // Черновики/отложенные (status ≠ PUBLISHED) видит только автор; остальным — лишь опубликованные.
    return {
      deletedAt: null,
      OR: or,
      AND: [{ OR: [{ status: 'PUBLISHED' }, { authorId: viewer.sub }] }],
    }
  }

  // Where-условие таба ленты. Всегда применяется через AND поверх visibilityWhere.
  // «Преподаватели» = посты ОТ преподавателей (audience TEACHERS адресован преподавателям и
  // студентам не виден — как таб бесполезен); «Важное» = закреплённые.
  private feedFilterWhere(filter?: FeedFilterValue): Prisma.PostWhereInput | null {
    switch (filter) {
      case 'GROUP':
        return { audience: PostAudience.GROUP }
      case 'UNIVERSITY':
        return { audience: PostAudience.UNIVERSITY }
      case 'TEACHERS':
        return { author: { role: Role.TEACHER } }
      case 'IMPORTANT':
        return { pinnedAt: { not: null } }
      default:
        return null
    }
  }

  private async findVisibleOrThrow<S extends Prisma.PostSelect>(
    viewer: JwtPayload,
    id: string,
    select: S,
  ): Promise<Prisma.PostGetPayload<{ select: S }>> {
    const post = await this.prisma.post.findFirst({
      where: { id, ...this.visibilityWhere(viewer) },
      select,
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    return post as Prisma.PostGetPayload<{ select: S }>
  }

  // ── Лента (задача 8.3) — cursor-пагинация + приоритет ──────────────────────

  async feed(viewer: JwtPayload, query: FeedQueryInput): Promise<Paginated<PostRow>> {
    // authorId (вкладка «Посты» в профиле) всегда пересекается с видимостью зрителя —
    // нельзя увидеть чужие посты в обход прав (IDOR-защита).
    const base = this.visibilityWhere(viewer)
    // Черновики/отложенные показываем ТОЛЬКО на своей вкладке профиля (authorId === зритель).
    // В общей ленте и в чужом профиле — только опубликованные (скрываем и свои черновики из ленты).
    if (!query.authorId || query.authorId !== viewer.sub) {
      ;(base.AND as Prisma.PostWhereInput[]).push({ status: 'PUBLISHED' })
    }
    // Таб ленты сужает выдачу поверх видимости (через AND) — обойти права нельзя.
    const filterWhere = this.feedFilterWhere(query.filter)
    if (filterWhere) (base.AND as Prisma.PostWhereInput[]).push(filterWhere)
    const where: Prisma.PostWhereInput = query.authorId
      ? { AND: [{ authorId: query.authorId }, base] }
      : base
    const rows = await this.prisma.post.findMany({
      where,
      select: POST_SELECT,
      // Закреплённые сверху, затем по приоритету и времени; id — стабильный tiebreaker для cursor.
      orderBy: [
        { pinnedAt: { sort: 'desc', nulls: 'last' } },
        { priority: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const items = hasNext ? rows.slice(0, query.limit) : rows
    const nextCursor = hasNext ? items[items.length - 1]?.id : undefined
    // Для вкладки «Посты» в профиле (authorId) отдаём общий счётчик — для бейджа на табе.
    // В общей ленте счётчик не считаем (лишний COUNT на горячем пути).
    const total = query.authorId ? await this.prisma.post.count({ where }) : undefined
    return new Paginated(items, {
      cursor: nextCursor,
      hasNext,
      ...(total !== undefined ? { total } : {}),
    })
  }

  async getById(viewer: JwtPayload, id: string): Promise<PostRow> {
    return this.findVisibleOrThrow(viewer, id, POST_SELECT)
  }

  /** Бросает NOT_FOUND, если пост не виден зрителю. Используется share-to-chat (ChatsService). */
  async assertVisibleToViewer(viewer: JwtPayload, id: string): Promise<void> {
    await this.findVisibleOrThrow(viewer, id, { id: true })
  }

  /** Инкремент просмотров поста (при открытии в лайтбоксе). Только если пост виден зрителю. */
  async incrementView(viewer: JwtPayload, id: string): Promise<{ views: number }> {
    await this.findVisibleOrThrow(viewer, id, { id: true })
    return this.prisma.post.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { views: true },
    })
  }

  /**
   * Presigned-GET к медиа поста: доступ по видимости поста зрителю (не по владению файлом) —
   * иначе чужие посты нельзя было бы показать. Файл обязан принадлежать именно этому посту.
   */
  async getMediaUrl(viewer: JwtPayload, postId: string, fileId: string): Promise<string> {
    await this.findVisibleOrThrow(viewer, postId, { id: true })
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, postId },
      select: { id: true },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Медиа не найдено')
    return this.files.getPresignedUrl(fileId)
  }

  // ── Создание (задачи 8.2, 8.7) ─────────────────────────────────────────────

  async create(actor: JwtPayload, input: CreatePostInput, ctx: RequestContext): Promise<PostRow> {
    const target = await this.resolveTarget(actor, input.audience as PostAudience, input)
    const post = await this.prisma.post.create({
      data: {
        authorId: actor.sub,
        audience: input.audience as PostAudience,
        content: input.content,
        priority: this.priorityFor(actor, input.audience as PostAudience),
        ...this.resolvePublishState(input),
        ...target,
      },
      select: { id: true },
    })
    if (input.mediaIds?.length) {
      await this.linkMedia(actor.sub, post.id, input.mediaIds)
    }
    await this.audit.record({
      userId: actor.sub,
      action: 'post_created',
      entity: 'Post',
      entityId: post.id,
      metadata: { audience: input.audience },
      ...ctx,
    })
    return this.getById(actor, post.id)
  }

  // Состояние публикации при создании: DRAFT — сохранить без публикации; будущий scheduledAt —
  // отложить (крон опубликует); иначе — опубликовать сейчас (проставив publishedAt).
  private resolvePublishState(input: CreatePostInput): {
    status: string
    scheduledAt: Date | null
    publishedAt: Date | null
  } {
    if (input.status === 'DRAFT') return { status: 'DRAFT', scheduledAt: null, publishedAt: null }
    if (input.scheduledAt && input.scheduledAt.getTime() > Date.now()) {
      return { status: 'SCHEDULED', scheduledAt: input.scheduledAt, publishedAt: null }
    }
    return { status: 'PUBLISHED', scheduledAt: null, publishedAt: new Date() }
  }

  /** Крон: публикует отложенные посты, у которых наступило время (status SCHEDULED → PUBLISHED). */
  async publishDueScheduled(): Promise<number> {
    const res = await this.prisma.post.updateMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
    if (res.count > 0) this.logger.log(`Опубликовано отложенных постов: ${res.count}`)
    return res.count
  }

  // ── Репост (задача 8.6) ─────────────────────────────────────────────────────

  async repost(
    actor: JwtPayload,
    id: string,
    input: RepostInput,
    ctx: RequestContext,
  ): Promise<PostRow> {
    // Репостить можно только видимый пост.
    const original = await this.findVisibleOrThrow(actor, id, { id: true, originalPostId: true })
    // Репост репоста ссылается на первоисточник.
    const originalPostId = original.originalPostId ?? original.id
    const target = await this.resolveTarget(actor, input.audience as PostAudience, input)
    const post = await this.prisma.post.create({
      data: {
        authorId: actor.sub,
        audience: input.audience as PostAudience,
        content: input.content ?? '',
        priority: this.priorityFor(actor, input.audience as PostAudience),
        originalPostId,
        ...target,
      },
      select: { id: true },
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_reposted',
      entity: 'Post',
      entityId: post.id,
      metadata: { originalPostId },
      ...ctx,
    })
    return this.getById(actor, post.id)
  }

  // ── Удаление (задача 8.5) — автор или модератор scope ──────────────────────

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: POST_SCOPE_SELECT,
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    if (post.authorId !== actor.sub) {
      this.assertModerator(actor, post)
    }
    await this.prisma.post.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_deleted',
      entity: 'Post',
      entityId: id,
      ...ctx,
    })
  }

  // ── Закрепление (задача 8.6) — роль строго выше автора ─────────────────────

  async setPinned(
    actor: JwtPayload,
    id: string,
    pinned: boolean,
    ctx: RequestContext,
  ): Promise<PostRow> {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { ...POST_SCOPE_SELECT, author: { select: { role: true } } },
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    if (ROLE_RANK[actor.role] <= ROLE_RANK[post.author.role]) {
      throw new AppException('FORBIDDEN', 'Закреплять может только роль выше автора')
    }
    this.assertModerator(actor, post)
    await this.prisma.post.update({
      where: { id },
      data: { pinnedAt: pinned ? new Date() : null, pinnedById: pinned ? actor.sub : null },
    })
    await this.audit.record({
      userId: actor.sub,
      action: pinned ? 'post_pinned' : 'post_unpinned',
      entity: 'Post',
      entityId: id,
      ...ctx,
    })
    return this.getById(actor, id)
  }

  // ── Реакции (задача 8.5) ────────────────────────────────────────────────────

  async addReaction(actor: JwtPayload, id: string, input: ReactionInput): Promise<void> {
    await this.findVisibleOrThrow(actor, id, { id: true })
    // Идемпотентно: повтор той же реакции не создаёт дубликат (unique [postId,userId,emoji]).
    await this.prisma.reaction.upsert({
      where: { postId_userId_emoji: { postId: id, userId: actor.sub, emoji: input.emoji } },
      update: {},
      create: { postId: id, userId: actor.sub, emoji: input.emoji },
    })
  }

  async removeReaction(actor: JwtPayload, id: string, emoji: string): Promise<void> {
    await this.prisma.reaction.deleteMany({ where: { postId: id, userId: actor.sub, emoji } })
  }

  // ── Комментарии (задача 8.5) ────────────────────────────────────────────────

  async listComments(viewer: JwtPayload, id: string) {
    await this.findVisibleOrThrow(viewer, id, { id: true })
    return this.prisma.comment.findMany({
      where: { postId: id, deletedAt: null },
      select: COMMENT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  }

  async addComment(actor: JwtPayload, id: string, input: CreateCommentInput) {
    await this.findVisibleOrThrow(actor, id, { id: true })
    let parentId = input.parentId ?? null
    if (parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: parentId, postId: id, deletedAt: null },
        select: { id: true, parentId: true },
      })
      if (!parent) {
        throw new AppException('BAD_REQUEST', 'Родительский комментарий не найден в этом посте')
      }
      // Максимум один уровень вложенности: ответ на ответ прикрепляем к корню ветки.
      parentId = parent.parentId ?? parent.id
    }
    return this.prisma.comment.create({
      data: { postId: id, authorId: actor.sub, parentId, content: input.content },
      select: COMMENT_SELECT,
    })
  }

  async removeComment(
    actor: JwtPayload,
    id: string,
    commentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, postId: id, deletedAt: null },
      select: { id: true, authorId: true, post: { select: POST_SCOPE_SELECT } },
    })
    if (!comment) {
      throw new AppException('NOT_FOUND', 'Комментарий не найден')
    }
    if (comment.authorId !== actor.sub) {
      this.assertModerator(actor, comment.post)
    }
    await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
    await this.audit.record({
      userId: actor.sub,
      action: 'comment_deleted',
      entity: 'Comment',
      entityId: commentId,
      ...ctx,
    })
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────────

  private priorityFor(actor: JwtPayload, audience: PostAudience): number {
    const base = AUDIENCE_PRIORITY[audience]
    // Посты сотрудников чуть выше студенческих в равной аудитории (docs/PROJECT.md §3.3).
    return base + (ROLE_RANK[actor.role] >= ROLE_RANK[Role.TEACHER] ? 2 : 0)
  }

  // Модерация поста: платформа — любой; админ/мод вуза — свой вуз; декан — свой факультет.
  private assertModerator(
    actor: JwtPayload,
    post: { universityId: string | null; facultyId: string | null },
  ): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.DEAN) {
      if (post.facultyId && post.facultyId === actor.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Пост другого факультета')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.UNIVERSITY_MODERATOR) {
      if (post.universityId && post.universityId === actor.universityId) return
      throw new AppException('WRONG_SCOPE', 'Пост другого университета')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  /** Проверяет аудиторию по роли и вычисляет scope-цель поста (защита от IDOR). */
  private async resolveTarget(
    actor: JwtPayload,
    audience: PostAudience,
    input: { facultyId?: string; groupId?: string; targetUserId?: string; subject?: string },
  ): Promise<PostTarget> {
    if (!ALLOWED_AUDIENCES[actor.role].includes(audience)) {
      throw new AppException('FORBIDDEN', 'Эта аудитория недоступна вашей роли')
    }
    switch (audience) {
      case PostAudience.ALL:
        return {}
      case PostAudience.UNIVERSITY:
      case PostAudience.TEACHERS:
        return { universityId: this.requireOwnUniversity(actor) }
      case PostAudience.FACULTY: {
        const facultyId = input.facultyId ?? actor.facultyId
        if (!facultyId) throw new AppException('BAD_REQUEST', 'Не указан факультет')
        const universityId = await this.assertFacultyInScope(actor, facultyId)
        return { facultyId, universityId }
      }
      case PostAudience.GROUP: {
        const groupId = input.groupId ?? actor.groupId
        if (!groupId) throw new AppException('BAD_REQUEST', 'Не указана группа')
        const scope = await this.assertGroupInScope(actor, groupId)
        return { groupId, facultyId: scope.facultyId, universityId: scope.universityId }
      }
      case PostAudience.SUBJECT: {
        if (!input.subject) throw new AppException('BAD_REQUEST', 'Не указан предмет')
        return { subject: input.subject, universityId: this.requireOwnUniversity(actor) }
      }
      case PostAudience.PERSONAL: {
        if (!input.targetUserId) throw new AppException('BAD_REQUEST', 'Не указан получатель')
        await this.assertTargetUser(actor, input.targetUserId)
        return { targetUserId: input.targetUserId }
      }
      default:
        throw new AppException('BAD_REQUEST', 'Неизвестная аудитория')
    }
  }

  private requireOwnUniversity(actor: JwtPayload): string {
    if (!actor.universityId) {
      throw new AppException('BAD_REQUEST', 'Пользователь не привязан к университету')
    }
    return actor.universityId
  }

  private async assertFacultyInScope(actor: JwtPayload, facultyId: string): Promise<string> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { universityId: true },
    })
    if (!faculty) throw new AppException('NOT_FOUND', 'Факультет не найден')
    if (isPlatform(actor.role)) return faculty.universityId
    if (actor.role === Role.DEAN) {
      if (actor.facultyId !== facultyId) throw new AppException('WRONG_SCOPE', 'Чужой факультет')
    } else if (faculty.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Факультет другого университета')
    }
    return faculty.universityId
  }

  private async assertGroupInScope(
    actor: JwtPayload,
    groupId: string,
  ): Promise<{ facultyId: string; universityId: string }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    const universityId = group.faculty.universityId
    if (isPlatform(actor.role)) return { facultyId: group.facultyId, universityId }
    if (actor.role === Role.STUDENT || actor.role === Role.STAROSTA) {
      if (actor.groupId !== groupId) throw new AppException('WRONG_SCOPE', 'Чужая группа')
    } else if (actor.role === Role.DEAN) {
      if (actor.facultyId !== group.facultyId)
        throw new AppException('WRONG_SCOPE', 'Чужой факультет')
    } else if (universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Группа другого университета')
    }
    return { facultyId: group.facultyId, universityId }
  }

  private async assertTargetUser(actor: JwtPayload, targetUserId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { universityId: true },
    })
    if (!user) throw new AppException('NOT_FOUND', 'Получатель не найден')
    if (!isPlatform(actor.role) && user.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Получатель из другого университета')
    }
  }

  private async linkMedia(ownerId: string, postId: string, mediaIds: string[]): Promise<void> {
    const bucket = this.config.get('MINIO_BUCKET_POSTS', { infer: true })
    const files = await this.prisma.file.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true, ownerId: true, bucket: true, postId: true },
      take: mediaIds.length,
    })
    const valid = files.filter(
      (f) => f.ownerId === ownerId && f.bucket === bucket && f.postId === null,
    )
    if (valid.length !== mediaIds.length) {
      throw new AppException('BAD_REQUEST', 'Некоторые файлы недоступны для прикрепления')
    }
    await this.prisma.file.updateMany({
      where: { id: { in: valid.map((f) => f.id) } },
      data: { postId },
    })
  }
}
