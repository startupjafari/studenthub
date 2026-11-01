'use client'

import { PublicUserProfile } from '../../../widgets/user-profile'
import { StoryViewer } from '../../../widgets/stories-rail'

// Чужой профиль: виджет профиля + окно сторис для кольца вокруг аватара (см. MyProfileView).
export function PublicProfileView({ userId }: { userId: string }) {
  return (
    <PublicUserProfile
      userId={userId}
      renderStoryViewer={(ring, onClose) => (
        <StoryViewer rings={[ring]} startIndex={0} onClose={onClose} />
      )}
    />
  )
}
