import type {
  CareerEventKind,
  EventMeeting,
  MeetingProviderValue,
  PostAudienceValue,
} from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'
import type { MediaStatus } from '../../../shared/api'
export type { EventMeeting, MeetingProviderValue, PostAudienceValue }

/**
 * Как подписан провайдер встречи. Названия сервисов — имена собственные и не
 * переводятся; у OTHER подписи нет — её берут из i18n («другой сервис»).
 */
export const MEETING_PROVIDER_NAME: Record<MeetingProviderValue, string | null> = {
  ZOOM: 'Zoom',
  GOOGLE_MEET: 'Google Meet',
  TEAMS: 'Microsoft Teams',
  OTHER: null,
}

export interface EventOrganizer {
  id: string
  firstName: string
  lastName: string
}

export interface EventItem {
  id: string
  audience: PostAudienceValue
  title: string
  description: string
  location: string | null
  isOnline: boolean
  /** Провайдер встречи; сама ссылка в карточке не приходит — только по /meeting. */
  meetingProvider: MeetingProviderValue | null
  /** Тип карьерного мероприятия; null — обычное событие. Необязательное: старый ответ без поля. */
  careerKind?: CareerEventKind | null
  startsAt: string
  endsAt: string | null
  organizerId: string
  organizer: EventOrganizer
  _count: { participants: number }
  isRegistered: boolean
  /**
   * Может ли зритель управлять событием (правка, удаление, участники) — считает сервер по
   * своему правилу (организатор, платформа, декан факультета события, админ вуза события).
   * Необязательное: старый ответ без поля — запасной расчёт по роли.
   */
  canManage?: boolean
}

export interface EventParticipant {
  userId: string
  createdAt: string
  /** Поля сверх ФИО необязательны: их нет в ответах сервера до расширения списка. */
  user: EventOrganizer & {
    avatarThumbUrl?: string | null
    role?: Role
    group?: { name: string } | null
    faculty?: { name: string } | null
  }
}

/** Страница участников по порядку регистрации; `cursor` — по нему просят следующую. */
export interface EventParticipantsPage {
  items: EventParticipant[]
  cursor?: string
  hasNext: boolean
}

/**
 * Вложение комментария — та же форма, что у вложения сообщения чата: показывается тем же
 * компонентом, ссылку на байты выдаёт отдельный запрос (fetchEventCommentAttachmentLink).
 */
export interface EventCommentAttachment {
  id: string
  mime: string
  size: number
  name?: string | null
  spoiler?: boolean
  asDocument?: boolean
  width?: number | null
  height?: number | null
  placeholder?: string | null
  mediaStatus?: MediaStatus
  durationMs?: number | null
}

/** Реакция — как у сообщения чата: кто и каким эмодзи. */
export interface EventCommentReaction {
  emoji: string
  userId: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

/** Цитата комментария, на который ответили. У удалённого оригинала текста нет. */
export interface EventCommentReply {
  id: string
  author: EventOrganizer
  content: string
  mediaCount: number
  deleted: boolean
}

export interface EventComment {
  id: string
  content: string
  createdAt: string
  author: EventOrganizer & { avatarThumbUrl: string | null }
  /** Поля «как в чате» необязательны: старый ответ сервера их не знал. */
  media?: EventCommentAttachment[]
  reactions?: EventCommentReaction[]
  replyTo?: EventCommentReply | null
  /** Может ли зритель удалить комментарий (автор или модерация по правилам сервера). */
  canDelete?: boolean
}

/** Страница обсуждения: свежие сверху, `cursor` — самый старый комментарий страницы. */
export interface EventCommentsPage {
  items: EventComment[]
  cursor?: string
  hasNext: boolean
  /** Сколько комментариев всего — для заголовка, не зависит от догруженных страниц. */
  total?: number
}
