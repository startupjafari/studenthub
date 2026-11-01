import type {
  CreateStoryInput,
  UpdateStoryAudienceInput,
  UpdateStoryHighlightInput,
} from '@studenthub/shared-schemas'
import {
  api,
  needsDirectUpload,
  uploadDirect,
  uploadFileRequest,
  type PresignedTarget,
  type UploadedFile,
} from '../../../shared/api'
import type { ResponseWithMeta } from '../../../shared/api/instance'
import type {
  StoryCard,
  StoryHighlightDetail,
  StoryHighlightSummary,
  StoryRing,
  StoryViewer,
} from '../model/types'

export const storyKeys = {
  all: ['stories'] as const,
  feed: () => ['stories', 'feed'] as const,
  author: (userId: string) => ['stories', 'author', userId] as const,
  detail: (id: string) => ['stories', 'detail', id] as const,
  viewers: (id: string) => ['stories', id, 'viewers'] as const,
  highlights: (ownerId: string) => ['stories', 'highlights', ownerId] as const,
  highlight: (id: string) => ['stories', 'highlight', id] as const,
}

/**
 * Живые сторисы, уже сгруппированные сервером в кольца. Пагинации нет: выдача
 * ограничена сроком жизни (24 часа), а не историей.
 */
export async function fetchStories(authorId?: string): Promise<StoryRing[]> {
  const { data } = await api.get<StoryRing[]>('/stories', {
    params: authorId ? { authorId } : undefined,
  })
  return data
}

/** Одна сторис по id — для ссылки `/stories/:id`. Сервер проверяет аудиторию и блокировки. */
export async function fetchStory(id: string): Promise<StoryCard> {
  const { data } = await api.get<StoryCard>(`/stories/${id}`)
  return data
}

/**
 * Ответ на сторис — личным сообщением автору с карточкой сторис. Чат с автором сервер
 * находит или создаёт сам, по обычным правилам переписки.
 */
export async function replyToStoryRequest(
  storyId: string,
  content: string,
): Promise<{ chatId: string }> {
  const { data } = await api.post<{ chatId: string }>('/chats/story-reply', { storyId, content })
  return data
}

/** Переслать сторис в личный чат: сервер проверит, что получатель сам её видит. */
export async function shareStoryRequest(chatId: string, storyId: string): Promise<void> {
  await api.post(`/chats/${chatId}/share-story`, { storyId })
}

/** Скрыть сторис автора из ленты колец (профиль их по-прежнему показывает). */
export async function muteStoryAuthorRequest(userId: string): Promise<void> {
  await api.post(`/stories/mutes/${userId}`)
}

/** Вернуть сторис автора в ленту колец. */
export async function unmuteStoryAuthorRequest(userId: string): Promise<void> {
  await api.delete(`/stories/mutes/${userId}`)
}

export async function createStoryRequest(input: CreateStoryInput): Promise<StoryCard> {
  const { data } = await api.post<StoryCard>('/stories', input)
  return data
}

export async function deleteStoryRequest(id: string): Promise<void> {
  await api.delete(`/stories/${id}`)
}

/** Сменить аудиторию своей живой сторис — новый круг действует сразу. */
export async function updateStoryAudienceRequest(
  id: string,
  input: UpdateStoryAudienceInput,
): Promise<StoryCard> {
  const { data } = await api.patch<StoryCard>(`/stories/${id}/audience`, input)
  return data
}

// ── «Актуальное» ──────────────────────────────────────────────────────────────

/** Подборки в профиле — только те, где зрителю видна хотя бы одна сторис. */
export async function fetchStoryHighlights(ownerId: string): Promise<StoryHighlightSummary[]> {
  const { data } = await api.get<StoryHighlightSummary[]>('/stories/highlights', {
    params: { ownerId },
  })
  return data
}

export async function fetchStoryHighlight(id: string): Promise<StoryHighlightDetail> {
  const { data } = await api.get<StoryHighlightDetail>(`/stories/highlights/${id}`)
  return data
}

/** Новая подборка — сразу с первой сторис (медиа сервер копирует к себе). */
export async function createStoryHighlightRequest(
  title: string,
  storyId: string,
): Promise<StoryHighlightDetail> {
  const { data } = await api.post<StoryHighlightDetail>('/stories/highlights', { title, storyId })
  return data
}

export async function updateStoryHighlightRequest(
  id: string,
  input: UpdateStoryHighlightInput,
): Promise<StoryHighlightDetail> {
  const { data } = await api.patch<StoryHighlightDetail>(`/stories/highlights/${id}`, input)
  return data
}

export async function deleteStoryHighlightRequest(id: string): Promise<void> {
  await api.delete(`/stories/highlights/${id}`)
}

/** Порядок подборок в профиле — полный список своих id. */
export async function reorderStoryHighlightsRequest(ids: string[]): Promise<void> {
  await api.put('/stories/highlights/order', { ids })
}

export async function addStoryHighlightItemRequest(
  id: string,
  storyId: string,
): Promise<StoryHighlightDetail> {
  const { data } = await api.post<StoryHighlightDetail>(`/stories/highlights/${id}/items`, {
    storyId,
  })
  return data
}

/** Убрать сторис из подборки; `deleted` — подборка опустела и удалена целиком. */
export async function removeStoryHighlightItemRequest(
  id: string,
  itemId: string,
): Promise<{ deleted: boolean }> {
  const { data } = await api.delete<{ deleted: boolean }>(
    `/stories/highlights/${id}/items/${itemId}`,
  )
  return data
}

export async function reorderStoryHighlightItemsRequest(id: string, ids: string[]): Promise<void> {
  await api.put(`/stories/highlights/${id}/items/order`, { ids })
}

/** Отметка просмотра. Идемпотентна, поэтому повторный вызов безопасен. */
export async function markStoryViewed(id: string): Promise<void> {
  await api.post(`/stories/${id}/view`)
}

export async function addStoryReactionRequest(id: string, emoji: string): Promise<void> {
  await api.post(`/stories/${id}/reactions`, { emoji })
}

export async function removeStoryReactionRequest(id: string, emoji: string): Promise<void> {
  await api.delete(`/stories/${id}/reactions/${encodeURIComponent(emoji)}`)
}

/** Голос в опросе: сервер возвращает сторис с пересчитанными результатами. */
export async function voteStoryRequest(id: string, optionId: string): Promise<StoryCard> {
  const { data } = await api.post<StoryCard>(`/stories/${id}/vote`, { optionId })
  return data
}

export interface StoryViewersPage {
  items: StoryViewer[]
  cursor?: string
  hasNext: boolean
}

export async function fetchStoryViewers(id: string, cursor?: string): Promise<StoryViewersPage> {
  const res = (await api.get<StoryViewer[]>(`/stories/${id}/viewers`, {
    params: { limit: 20, ...(cursor ? { cursor } : {}) },
  })) as ResponseWithMeta & { data: StoryViewer[] }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
}

/**
 * Загрузка медиа сторис. Мелкое идёт буферно через API, крупное — подписанной ссылкой
 * прямо в MinIO (docs/BACKEND_RULES.md §8): видео с телефона порог буферной загрузки
 * перешагивает всегда.
 */
export async function uploadStoryMedia(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadedFile> {
  if (!needsDirectUpload(file.size)) return uploadFileRequest('STORIES', file, onProgress)
  return uploadDirect<UploadedFile>({
    file,
    onProgress,
    presign: async (mime) => {
      const { data } = await api.post<PresignedTarget>('/files/presign', {
        bucket: 'STORIES',
        mime,
      })
      return data
    },
    confirm: async (key, name) => {
      const { data } = await api.post<UploadedFile>('/files/confirm', {
        bucket: 'STORIES',
        key,
        ...(name ? { name } : {}),
      })
      return data
    },
  })
}
