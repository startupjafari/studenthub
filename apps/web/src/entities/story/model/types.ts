// Типы сторис — зеркало ответов API (docs/PROJECT.md §3.4, Ф14.1).
import type { StoryAudienceValue, StoryBackgroundValue } from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'

export type { StoryAudienceValue, StoryBackgroundValue }

export interface StoryAuthor {
  id: string
  firstName: string
  lastName: string
  role: Role
  avatarUrl: string | null
}

/**
 * Медиа сторис. Ссылка приходит уже подписанной и живёт 15 минут: сторис смотрят
 * сразу после открытия ленты, и отдельный запрос за URL на каждый кадр был бы
 * задержкой ровно там, где её видно.
 */
export interface StoryMedia {
  id: string
  mime: string
  width: number | null
  height: number | null
  url: string
}

export interface StoryPollOption {
  id: string
  text: string
  order: number
  votes: number
}

export interface StoryPoll {
  id: string
  question: string
  options: StoryPollOption[]
  totalVotes: number
  /** Вариант, за который проголосовал зритель; null — ещё не голосовал. */
  myOptionId: string | null
}

export interface StoryReaction {
  emoji: string
  count: number
  mine: boolean
}

export interface StoryCard {
  id: string
  audience: StoryAudienceValue
  text: string | null
  background: StoryBackgroundValue | null
  linkUrl: string | null
  linkLabel: string | null
  createdAt: string
  expiresAt: string
  author: StoryAuthor
  media: StoryMedia | null
  poll: StoryPoll | null
  reactions: StoryReaction[]
  seen: boolean
  /** Число просмотров приходит только автору; остальным — null. */
  viewsCount: number | null
  canDelete: boolean
}

/** Кольцо ленты: автор и его живые сторисы по возрастанию времени. */
export interface StoryRing {
  author: StoryAuthor
  stories: StoryCard[]
  hasUnseen: boolean
}

export interface StoryViewer {
  id: string
  createdAt: string
  user: StoryAuthor
}
