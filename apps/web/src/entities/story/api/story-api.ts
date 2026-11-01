import type { CreateStoryInput } from '@studenthub/shared-schemas'
import {
  api,
  needsDirectUpload,
  uploadDirect,
  uploadFileRequest,
  type PresignedTarget,
  type UploadedFile,
} from '../../../shared/api'
import type { ResponseWithMeta } from '../../../shared/api/instance'
import type { StoryCard, StoryRing, StoryViewer } from '../model/types'

export const storyKeys = {
  all: ['stories'] as const,
  feed: () => ['stories', 'feed'] as const,
  author: (userId: string) => ['stories', 'author', userId] as const,
  detail: (id: string) => ['stories', 'detail', id] as const,
  viewers: (id: string) => ['stories', id, 'viewers'] as const,
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
