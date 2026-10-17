// Типы постов — зеркало ответов API (docs/PROJECT.md §3.3, Ф8).
import type { MediaPreview, MediaSource, MediaStatus } from '../../../shared/api'
import type { PostAudienceValue, PostReactionSummary } from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'

export type { PostAudienceValue, PostReactionSummary }

export interface PostAuthor {
  id: string
  firstName: string
  lastName: string
  role: Role
  avatarUrl: string | null
}

/**
 * Медиа поста. Лента и пост по id подписывают ссылки пачкой на всю выдачу: `url` оригинала
 * и варианты (MediaInfo) приходят прямо здесь. Поля необязательные — у старого ответа API их
 * нет, и тогда ссылку даёт отдельная ручка (`fetchPostMediaLink`), она же продлевает истёкшую.
 */
export interface PostMedia extends MediaPreview {
  id: string
  mime: string
  url?: string
  /** Когда протухнут подписанные ссылки; `null` — ссылки постоянные. */
  expiresAt?: string | null
  status?: MediaStatus
  sources?: MediaSource[]
  poster?: MediaSource[]
  hls?: string | null
}

/** Строка «кто что поставил» — устаревшая форма реакций, веб её больше не запрашивает. */
export interface PostReaction {
  emoji: string
  userId: string
}

export interface FeedPost {
  id: string
  audience: PostAudienceValue
  /** Заголовок публикации; null — короткая заметка без заголовка. */
  title: string | null
  /** Текст в ограниченном markdown — рисуется компонентом Markdown. */
  content: string
  authorId: string
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  targetUserId: string | null
  subject: string | null
  priority: number
  pinnedAt: string | null
  originalPostId: string | null
  views: number
  status: string
  scheduledAt: string | null
  publishedAt: string | null
  createdAt: string
  author: PostAuthor
  media: PostMedia[]
  /**
   * Реакции сводкой: сколько каждой и стоит ли своя. Нет — ответ старого API; тогда сводку
   * собирает `reactionSummaryOf` из построчного `reactions`.
   */
  reactionSummary?: PostReactionSummary[]
  /**
   * Устаревшее: все реакции поста строками. Лента веба приходит без него (`reactions=summary`),
   * пост по id — пока с ним (его читают мобильные клиенты).
   */
  reactions?: PostReaction[]
  original: { id: string; title: string | null; content: string; author: PostAuthor } | null
  _count: { comments: number }
  /**
   * Сохранён ли пост ЗРИТЕЛЕМ. Личный признак: сколько людей сохранили пост, API не
   * отдаёт и не считает — в отличие от реакций, которые видны всем намеренно.
   */
  bookmarked: boolean
  /**
   * Права зрителя, посчитанные сервером теми же правилами, что и сами действия (ранг
   * относительно автора и scope). Нет — ответ старого API: тогда решает роль, как раньше.
   */
  canDelete?: boolean
  canPin?: boolean
}

export interface PostComment {
  id: string
  postId: string
  parentId: string | null
  content: string
  createdAt: string
  author: PostAuthor
  /** Может ли зритель удалить комментарий: автор, автор поста или модерация scope. */
  canDelete?: boolean
}

/** Страница обсуждения: свежие сверху, `cursor` — самый старый комментарий страницы. */
export interface PostCommentsPage {
  items: PostComment[]
  cursor?: string
  hasNext: boolean
  /** Сколько комментариев всего — для заголовка, не зависит от догруженных страниц. */
  total?: number
}

// Аудитории и подписи — порядок для селекта при создании.
export const POST_AUDIENCES: PostAudienceValue[] = [
  'ALL',
  'UNIVERSITY',
  'FACULTY',
  'GROUP',
  'SUBJECT',
  'TEACHERS',
  'PERSONAL',
]
