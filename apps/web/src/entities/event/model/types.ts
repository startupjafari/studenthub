import type {
  EventMeeting,
  MeetingProviderValue,
  PostAudienceValue,
} from '@studenthub/shared-schemas'
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
  startsAt: string
  endsAt: string | null
  organizerId: string
  organizer: EventOrganizer
  _count: { participants: number }
  isRegistered: boolean
}

export interface EventParticipant {
  userId: string
  createdAt: string
  user: EventOrganizer
}

export interface EventComment {
  id: string
  content: string
  createdAt: string
  author: EventOrganizer & { avatarThumbUrl: string | null }
}
