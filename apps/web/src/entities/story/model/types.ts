// Типы сторис — зеркало ответов API (docs/PROJECT.md §3.4, Ф14.1).
import type { MediaInfo } from '../../../shared/api'
import type {
  StoryAudienceValue,
  StoryBackgroundValue,
  StoryElementInput,
} from '@studenthub/shared-schemas'
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
export interface StoryMedia extends MediaInfo {
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

/**
 * Элемент поверх кадра из редактора (текст, эмодзи, отметка человека). Позиция — доли
 * кадра 0..1 (центр элемента), поэтому одинаково ложится на любой размер. У отметки
 * сервер подставляет имя; удалённых и заблокированных в выдаче нет.
 */
type ElementOf<T extends StoryElementInput['type']> = Extract<StoryElementInput, { type: T }>

/** Событие на стикере — то, что видно зрителю, и его собственная регистрация. */
export interface StoryEventCard {
  id: string
  title: string
  startsAt: string
  endsAt: string | null
  location: string | null
  isOnline: boolean
  isRegistered: boolean
}

/** Публикация на стикере: автор, заголовок и начало текста. */
export interface StoryPostCard {
  id: string
  authorId: string
  authorName: string
  title: string | null
  excerpt: string
}

/** Пара на стикере: без преподавателя — сторис видят и те, кому его расписание ни к чему. */
export interface StoryPairCard {
  id: string
  subject: string
  startTime: string
  endTime: string
  room: string | null
  group: string
}

/**
 * Карточки (событие, пост, пара) сервер собирает по правам зрителя: невидимое или
 * удалённое приходит как `null` — показываем «недоступно».
 */
export type StoryElement =
  | ElementOf<'text'>
  | ElementOf<'emoji'>
  | (ElementOf<'mention'> & { name: string })
  | (ElementOf<'event'> & { event: StoryEventCard | null })
  | (ElementOf<'post'> & { post: StoryPostCard | null })
  | (ElementOf<'schedule'> & { pair: StoryPairCard | null })

export interface StoryCard {
  id: string
  audience: StoryAudienceValue
  text: string | null
  background: StoryBackgroundValue | null
  linkUrl: string | null
  linkLabel: string | null
  /** Тексты, эмодзи и отметки поверх кадра. У старых сторис — пусто. */
  elements: StoryElement[]
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
  /** Реакции этого зрителя на сторис (видит только автор). */
  reactions: string[]
}
