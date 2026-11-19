'use client'

import { useQuery } from '@tanstack/react-query'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { STORIES_ENABLED } from '../../../shared/config'
import { useLiveRefresh } from '../../../shared/realtime'
import { fetchStories, storyKeys } from '../api/story-api'
import type { StoryRing } from './types'

/**
 * Живые сторисы одного автора — для кольца вокруг аватара в профиле, как в Instagram.
 * Пусто (нет сторис, раздел выключен, автор не определён) — `null`: кольца нет, аватар
 * обычный. Свежесть та же, что у ленты колец: минута.
 */
export function useAuthorStories(userId: string | undefined): StoryRing | null {
  const q = useQuery({
    queryKey: storyKeys.author(userId ?? ''),
    queryFn: () => fetchStories(userId),
    enabled: STORIES_ENABLED && !!userId,
    staleTime: 60 * 1000,
  })
  // Кольцо в профиле живое (§9.2d): автор выложил или удалил историю — перечитываем только
  // его кольцо, сигналы о других авторах этот профиль не касаются.
  useLiveRefresh(
    REALTIME_EVENTS.storiesChanged,
    (envelope) => (userId && envelope.entityId === userId ? [storyKeys.author(userId)] : null),
    { enabled: STORIES_ENABLED && !!userId },
  )
  return q.data?.find((r) => r.author.id === userId && r.stories.length > 0) ?? null
}
