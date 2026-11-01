import type { StoryCard, StoryHighlightDetail, StoryRing } from '../model/types'

/**
 * Подборка «Актуального» в форме кольца для просмотрщика сторис: тот же кадр, медиа и
 * элементы, а реакций, опроса и счётчиков у снимка нет. Срок жизни снимку не нужен —
 * `expiresAt` повторяет дату публикации, его просмотрщик в режиме подборки не читает.
 */
export function highlightRing(detail: StoryHighlightDetail): StoryRing {
  const stories: StoryCard[] = detail.items.map((item) => ({
    ...item,
    audienceUsers: null,
    expiresAt: item.createdAt,
    author: detail.owner,
    poll: null,
    reactions: [],
    seen: true,
    viewsCount: null,
    canDelete: false,
  }))
  return { author: detail.owner, stories, hasUnseen: false }
}
