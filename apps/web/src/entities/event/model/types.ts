import type { PostAudienceValue } from '@studenthub/shared-schemas'
export type { PostAudienceValue }

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
