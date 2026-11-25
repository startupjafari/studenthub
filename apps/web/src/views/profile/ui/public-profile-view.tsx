'use client'

import { PublicUserProfile } from '../../../widgets/user-profile'
import { StoryHighlightsRow, StoryViewer } from '../../../widgets/stories-rail'
import { ArticleWindowHost } from '../../../widgets/article-window'

// Чужой профиль: виджет профиля + окно сторис, ряд «Актуального» (см. MyProfileView) и окно
// статьи из адреса (`?article=`).
export function PublicProfileView({ userId }: { userId: string }) {
  return (
    <>
      <PublicUserProfile
        userId={userId}
        renderStoryViewer={(ring, onClose) => (
          <StoryViewer rings={[ring]} startIndex={0} onClose={onClose} />
        )}
        renderHighlights={(ownerId) => <StoryHighlightsRow ownerId={ownerId} />}
      />
      <ArticleWindowHost />
    </>
  )
}
