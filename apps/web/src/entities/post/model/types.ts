// Типы постов — зеркало ответов API (docs/PROJECT.md §3.3, Ф8).
import type { PostAudienceValue } from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'

export type { PostAudienceValue }

export interface PostAuthor {
  id: string
  firstName: string
  lastName: string
  role: Role
  avatarUrl: string | null
}

export interface PostMedia {
  id: string
  mime: string
}

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
  reactions: PostReaction[]
  original: { id: string; title: string | null; content: string; author: PostAuthor } | null
  _count: { comments: number }
}

export interface PostComment {
  id: string
  postId: string
  parentId: string | null
  content: string
  createdAt: string
  author: PostAuthor
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
