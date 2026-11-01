'use client'

import { UserProfile } from '../../../widgets/user-profile'
import { StoryHighlightsRow, StoryViewer } from '../../../widgets/stories-rail'

// Свой профиль: виджет профиля + окно сторис для кольца вокруг аватара и ряд «Актуального».
// Склейка здесь, а не в виджете: виджеты друг друга не импортируют (FRONTEND_RULES §2.1).
export function MyProfileView() {
  return (
    <UserProfile
      renderStoryViewer={(ring, onClose) => (
        <StoryViewer rings={[ring]} startIndex={0} onClose={onClose} />
      )}
      renderHighlights={(ownerId) => <StoryHighlightsRow ownerId={ownerId} />}
    />
  )
}
