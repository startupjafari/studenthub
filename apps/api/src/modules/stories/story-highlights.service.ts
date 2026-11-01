import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, StoryAudience } from '@prisma/client'
import {
  STORY_HIGHLIGHTS_MAX,
  STORY_HIGHLIGHT_ITEMS_MAX,
  type CreateStoryHighlightInput,
  type UpdateStoryHighlightInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { FileService } from '../files/file.service'
import { MEDIA_FILE_SELECT } from '../media/media.types'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import type { EnvVars } from '../../config/env.schema'
import {
  AUTHOR_SELECT,
  StoriesService,
  audienceConditions,
  audienceIncludes,
  parseElements,
  type StoryCard,
  type StoryElementView,
} from './stories.service'

// Поля сторис, которые переносятся в снимок «Актуального».
const SNAPSHOT_SELECT = {
  id: true,
  audience: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  audienceUserIds: true,
  fileId: true,
  text: true,
  background: true,
  linkUrl: true,
  linkLabel: true,
  elements: true,
  createdAt: true,
} satisfies Prisma.StorySelect

const ITEM_SELECT = {
  id: true,
  audience: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  audienceUserIds: true,
  text: true,
  background: true,
  linkUrl: true,
  linkLabel: true,
  elements: true,
  storyCreatedAt: true,
  file: { select: MEDIA_FILE_SELECT },
} satisfies Prisma.StoryHighlightItemSelect

type ItemRow = Prisma.StoryHighlightItemGetPayload<{ select: typeof ITEM_SELECT }>
type ItemOrder = Prisma.StoryHighlightItemOrderByWithRelationInput[]

const ITEM_ORDER: ItemOrder = [{ position: 'asc' }, { id: 'asc' }]

/** Сторис из подборки глазами зрителя: снимок без опроса, реакций и счётчиков. */
export interface HighlightItemCard {
  id: string
  audience: StoryAudience
  text: string | null
  background: string | null
  linkUrl: string | null
  linkLabel: string | null
  elements: StoryElementView[]
  /** Когда вышла исходная сторис. */
  createdAt: Date
  media: StoryCard['media']
}

/** Подборка в ряду профиля: обложка — выбранная или первая видимая зрителю сторис. */
export interface HighlightSummary {
  id: string
  title: string
  cover: {
    itemId: string
    text: string | null
    background: string | null
    media: StoryCard['media']
  } | null
  /** Сколько сторис подборки видит зритель (автору — все). */
  itemsCount: number
}

export interface HighlightDetail {
  id: string
  title: string
  coverItemId: string | null
  owner: Prisma.UserGetPayload<typeof AUTHOR_SELECT>
  items: HighlightItemCard[]
  canEdit: boolean
}

/**
 * «Актуальное» (docs/PROJECT.md §3.4): подборки сторис в профиле автора.
 *
 * Элемент — снимок сторис с копией медиа в бакете без TTL; аудитория — тоже снимок и
 * проверяется на каждом чтении тем же правилом, что у живых сторис: кто не видел сторис,
 * не увидит её и в подборке. Дружба для FRIENDS — живая: удалённый из друзей выпадает
 * сразу. Блокировка в любую сторону скрывает подборки целиком.
 */
@Injectable()
export class StoryHighlightsService {
  private readonly logger = new Logger(StoryHighlightsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly files: FileService,
    private readonly stories: StoriesService,
  ) {}

  // ── Чтение ──────────────────────────────────────────────────────────────────

  async list(viewer: JwtPayload, ownerId: string): Promise<HighlightSummary[]> {
    const access = await this.access(viewer, ownerId)
    if (!access) return []
    const own = viewer.sub === ownerId
    const rows = await this.prisma.storyHighlight.findMany({
      where: { ownerId, ...(own ? {} : { items: { some: access.where } }) },
      select: {
        id: true,
        title: true,
        cover: { select: ITEM_SELECT },
        items: { where: access.where, orderBy: ITEM_ORDER, select: ITEM_SELECT, take: 1 },
        _count: { select: { items: { where: access.where } } },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: STORY_HIGHLIGHTS_MAX,
    })
    // Выбранная обложка — только если её сторис видна зрителю; иначе — первая видимая.
    const covers = rows.map((row) =>
      row.cover && access.sees(row.cover) ? row.cover : (row.items[0] ?? null),
    )
    const media = await this.stories.mediaFor(covers.flatMap((c) => (c?.file ? [c.file] : [])))
    return rows.map((row, index) => {
      const cover = covers[index]
      return {
        id: row.id,
        title: row.title,
        cover: cover
          ? {
              itemId: cover.id,
              text: cover.text,
              background: cover.background,
              media: (cover.file && media.get(cover.file.id)) || null,
            }
          : null,
        itemsCount: row._count.items,
      }
    })
  }

  async get(viewer: JwtPayload, id: string): Promise<HighlightDetail> {
    const highlight = await this.prisma.storyHighlight.findUnique({
      where: { id },
      select: { id: true, title: true, ownerId: true, coverItemId: true, owner: AUTHOR_SELECT },
    })
    const access = highlight ? await this.access(viewer, highlight.ownerId) : null
    if (!highlight || !access) throw notFound()
    const rows = await this.prisma.storyHighlightItem.findMany({
      where: { highlightId: id, ...access.where },
      select: ITEM_SELECT,
      orderBy: ITEM_ORDER,
      take: STORY_HIGHLIGHT_ITEMS_MAX,
    })
    // Подборка, в которой зрителю не видно ни одной сторис, для него не существует.
    if (rows.length === 0 && viewer.sub !== highlight.ownerId) throw notFound()
    return {
      id: highlight.id,
      title: highlight.title,
      coverItemId: viewer.sub === highlight.ownerId ? highlight.coverItemId : null,
      owner: highlight.owner,
      items: await this.cards(viewer, rows),
      canEdit: viewer.sub === highlight.ownerId,
    }
  }

  // ── Подборки ────────────────────────────────────────────────────────────────

  /** Новая подборка — сразу с первой сторис и первой в ряду профиля. */
  async create(
    actor: JwtPayload,
    input: CreateStoryHighlightInput,
    ctx: RequestContext,
  ): Promise<HighlightDetail> {
    const story = await this.ownLiveStory(actor, input.storyId)
    const copy = await this.copyMedia(actor, story.fileId)
    const created = await this.withCopy(copy, () =>
      this.prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, `story-highlights:${actor.sub}`)
        const count = await tx.storyHighlight.count({ where: { ownerId: actor.sub } })
        if (count >= STORY_HIGHLIGHTS_MAX) {
          throw new AppException('CONFLICT', `Не больше ${STORY_HIGHLIGHTS_MAX} подборок`)
        }
        const first = await tx.storyHighlight.findFirst({
          where: { ownerId: actor.sub },
          orderBy: { position: 'asc' },
          select: { position: true },
        })
        const highlight = await tx.storyHighlight.create({
          data: { ownerId: actor.sub, title: input.title, position: (first?.position ?? 1) - 1 },
          select: { id: true },
        })
        await tx.storyHighlightItem.create({
          data: snapshot(highlight.id, story, copy, 0),
        })
        return highlight
      }),
    )
    await this.audit.record({
      userId: actor.sub,
      action: 'story_highlight_created',
      entity: 'StoryHighlight',
      entityId: created.id,
      ...ctx,
    })
    return this.get(actor, created.id)
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdateStoryHighlightInput,
  ): Promise<HighlightDetail> {
    await this.ownHighlight(actor, id)
    if (input.coverItemId) {
      const item = await this.prisma.storyHighlightItem.findFirst({
        where: { id: input.coverItemId, highlightId: id },
        select: { id: true },
      })
      if (!item) throw new AppException('BAD_REQUEST', 'Обложка — сторис из этой подборки')
    }
    await this.prisma.storyHighlight.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.coverItemId !== undefined ? { coverItemId: input.coverItemId } : {}),
      },
    })
    return this.get(actor, id)
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.ownHighlight(actor, id)
    const items = await this.prisma.storyHighlightItem.findMany({
      where: { highlightId: id },
      select: { fileId: true },
      take: STORY_HIGHLIGHT_ITEMS_MAX,
    })
    await this.prisma.storyHighlight.delete({ where: { id } })
    await this.deleteFiles(items.flatMap((i) => (i.fileId ? [i.fileId] : [])))
    await this.audit.record({
      userId: actor.sub,
      action: 'story_highlight_deleted',
      entity: 'StoryHighlight',
      entityId: id,
      ...ctx,
    })
  }

  /** Порядок подборок в профиле: полный список своих id в нужной последовательности. */
  async reorder(actor: JwtPayload, ids: string[]): Promise<void> {
    const own = await this.prisma.storyHighlight.findMany({
      where: { ownerId: actor.sub },
      select: { id: true },
      take: STORY_HIGHLIGHTS_MAX,
    })
    assertSameSet(own, ids)
    await this.prisma.$transaction(
      ids.map((hid, position) =>
        this.prisma.storyHighlight.update({ where: { id: hid }, data: { position } }),
      ),
    )
  }

  // ── Сторис в подборке ───────────────────────────────────────────────────────

  async addItem(actor: JwtPayload, id: string, storyId: string): Promise<HighlightDetail> {
    await this.ownHighlight(actor, id)
    const story = await this.ownLiveStory(actor, storyId)
    const copy = await this.copyMedia(actor, story.fileId)
    await this.withCopy(copy, () =>
      this.prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, `story-highlight:${id}`)
        const [count, last] = await Promise.all([
          tx.storyHighlightItem.count({ where: { highlightId: id } }),
          tx.storyHighlightItem.findFirst({
            where: { highlightId: id },
            orderBy: { position: 'desc' },
            select: { position: true },
          }),
        ])
        if (count >= STORY_HIGHLIGHT_ITEMS_MAX) {
          throw new AppException(
            'CONFLICT',
            `В подборке не больше ${STORY_HIGHLIGHT_ITEMS_MAX} сторис`,
          )
        }
        try {
          await tx.storyHighlightItem.create({
            data: snapshot(id, story, copy, (last?.position ?? -1) + 1),
          })
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new AppException('CONFLICT', 'Эта сторис уже в подборке')
          }
          throw error
        }
      }),
    )
    return this.get(actor, id)
  }

  /** Убрать сторис из подборки; последняя ушла — подборка удаляется вместе с ней. */
  async removeItem(actor: JwtPayload, id: string, itemId: string): Promise<{ deleted: boolean }> {
    await this.ownHighlight(actor, id)
    const item = await this.prisma.storyHighlightItem.findFirst({
      where: { id: itemId, highlightId: id },
      select: { id: true, fileId: true },
    })
    if (!item) throw new AppException('NOT_FOUND', 'Сторис нет в подборке')
    await this.prisma.storyHighlightItem.delete({ where: { id: itemId } })
    const { count } = await this.prisma.storyHighlight.deleteMany({
      where: { id, items: { none: {} } },
    })
    if (item.fileId) await this.deleteFiles([item.fileId])
    return { deleted: count > 0 }
  }

  async reorderItems(actor: JwtPayload, id: string, ids: string[]): Promise<void> {
    await this.ownHighlight(actor, id)
    const items = await this.prisma.storyHighlightItem.findMany({
      where: { highlightId: id },
      select: { id: true },
      take: STORY_HIGHLIGHT_ITEMS_MAX,
    })
    assertSameSet(items, ids)
    await this.prisma.$transaction(
      ids.map((itemId, position) =>
        this.prisma.storyHighlightItem.update({ where: { id: itemId }, data: { position } }),
      ),
    )
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────────

  /**
   * Что из подборок владельца видит зритель: условие для выборки и та же проверка для
   * одной строки. `null` — ничего: блокировка в любую сторону или владельца больше нет.
   */
  private async access(
    viewer: JwtPayload,
    ownerId: string,
  ): Promise<{
    where: Prisma.StoryHighlightItemWhereInput
    sees: (item: ItemRow) => boolean
  } | null> {
    if (viewer.sub === ownerId) return { where: {}, sees: () => true }
    const [owner, blocks, friends] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: ownerId, deletedAt: null, isBlocked: false },
        select: { id: true },
      }),
      this.prisma.userBlock.count({
        where: {
          OR: [
            { blockerId: viewer.sub, blockedId: ownerId },
            { blockerId: ownerId, blockedId: viewer.sub },
          ],
        },
      }),
      this.stories.friendIdsAmong(ownerId, [viewer.sub]),
    ])
    if (!owner || blocks > 0) return null
    const or: Prisma.StoryHighlightItemWhereInput[] = [
      ...audienceConditions(viewer),
      ...(friends.size > 0 ? [{ audience: StoryAudience.FRIENDS }] : []),
    ]
    const user = {
      id: viewer.sub,
      role: viewer.role,
      universityId: viewer.universityId,
      facultyId: viewer.facultyId,
      groupId: viewer.groupId,
    }
    return {
      where: { OR: or },
      sees: (item) => audienceIncludes(user, { ...item, authorId: ownerId }, friends),
    }
  }

  private async cards(viewer: JwtPayload, rows: ItemRow[]): Promise<HighlightItemCard[]> {
    const [elements, media] = await Promise.all([
      this.stories.elementViews(
        viewer,
        new Map(rows.map((row) => [row.id, parseElements(row.elements)])),
      ),
      this.stories.mediaFor(rows.flatMap((row) => (row.file ? [row.file] : []))),
    ])
    return rows.map((row) => ({
      id: row.id,
      audience: row.audience,
      text: row.text,
      background: row.background,
      linkUrl: row.linkUrl,
      linkLabel: row.linkLabel,
      elements: elements.get(row.id) ?? [],
      createdAt: row.storyCreatedAt,
      media: (row.file && media.get(row.file.id)) || null,
    }))
  }

  private async ownHighlight(actor: JwtPayload, id: string): Promise<void> {
    const found = await this.prisma.storyHighlight.findFirst({
      where: { id, ownerId: actor.sub },
      select: { id: true },
    })
    // Чужая подборка — NOT_FOUND, как и несуществующая: id чужих подборок не подтверждаем.
    if (!found) throw notFound()
  }

  /** В «Актуальное» попадает только своя живая сторис: истёкшей уже нет и для автора. */
  private async ownLiveStory(actor: JwtPayload, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, authorId: actor.sub, expiresAt: { gt: new Date() } },
      select: SNAPSHOT_SELECT,
    })
    if (!story) throw new AppException('NOT_FOUND', 'Сторис не найдена')
    return story
  }

  /** Копия медиа в бакет «Актуального» — до транзакции: копирование объекта не откатить. */
  private async copyMedia(actor: JwtPayload, fileId: string | null): Promise<string | null> {
    if (!fileId) return null
    const bucket = this.config.get('MINIO_BUCKET_STORY_HIGHLIGHTS', { infer: true })
    const copy = await this.files.copyToBucket(fileId, bucket, actor.sub)
    return copy.id
  }

  /** Запись не создалась — копию убираем сразу, не дожидаясь ночной чистки. */
  private async withCopy<T>(copyId: string | null, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (copyId) await this.deleteFiles([copyId])
      throw error
    }
  }

  private async deleteFiles(ids: string[]): Promise<void> {
    for (const fileId of ids) {
      try {
        await this.files.delete(fileId)
      } catch (error) {
        this.logger.error(
          { err: error, fileId },
          'Не удалось удалить медиа «Актуального» — подберёт чистка',
        )
      }
    }
  }
}

function snapshot(
  highlightId: string,
  story: Prisma.StoryGetPayload<{ select: typeof SNAPSHOT_SELECT }>,
  fileId: string | null,
  position: number,
): Prisma.StoryHighlightItemUncheckedCreateInput {
  return {
    highlightId,
    sourceStoryId: story.id,
    audience: story.audience,
    universityId: story.universityId,
    facultyId: story.facultyId,
    groupId: story.groupId,
    audienceUserIds: story.audienceUserIds,
    fileId,
    text: story.text,
    background: story.background,
    linkUrl: story.linkUrl,
    linkLabel: story.linkLabel,
    elements: story.elements ?? Prisma.DbNull,
    storyCreatedAt: story.createdAt,
    position,
  }
}

/** Новый порядок обязан перечислить ровно то, что есть: без чужих, пропусков и лишних. */
function assertSameSet(existing: { id: string }[], ids: string[]): void {
  const known = new Set(existing.map((row) => row.id))
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw new AppException('BAD_REQUEST', 'Порядок должен перечислить все элементы', [
      { field: 'ids', message: 'Список не совпадает' },
    ])
  }
}

function notFound(): AppException {
  return new AppException('NOT_FOUND', 'Подборка не найдена')
}
