import type { CreatePostInput, FeedQueryInput, RepostInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ResponseWithMeta } from '../../../shared/api/instance'
import type { FeedPost, PostComment } from '../model/types'

export const postKeys = {
  all: ['posts'] as const,
  feed: (filter = 'ALL') => ['posts', 'feed', filter] as const,
  author: (userId: string) => ['posts', 'author', userId] as const,
  detail: (id: string) => ['posts', 'detail', id] as const,
  comments: (id: string) => ['posts', id, 'comments'] as const,
  media: (fileId: string) => ['posts', 'media', fileId] as const,
}

export interface FeedPage {
  items: FeedPost[]
  cursor?: string
  hasNext: boolean
  // Общий счётчик постов автора (только для вкладки профиля с authorId) — для бейджа таба.
  total?: number
}

export async function fetchFeed(query: FeedQueryInput = { limit: 20 }): Promise<FeedPage> {
  const res = (await api.get<FeedPost[]>('/posts', { params: query })) as ResponseWithMeta & {
    data: FeedPost[]
  }
  return {
    items: res.data,
    cursor: res.meta?.cursor,
    hasNext: res.meta?.hasNext ?? false,
    total: res.meta?.total,
  }
}

// Посты конкретного автора (вкладка «Посты» в профиле). authorId уходит в query;
// сервер пересекает с видимостью зрителя.
export async function fetchAuthorPosts(
  authorId: string,
  query: Omit<FeedQueryInput, 'authorId'> = { limit: 20 },
): Promise<FeedPage> {
  return fetchFeed({ ...query, authorId })
}

// Один пост по постоянной ссылке. Сервер сам решает, видим ли он зрителю:
// невидимый отвечает NOT_FOUND, а не «пустым» постом.
export async function fetchPost(id: string): Promise<FeedPost> {
  const { data } = await api.get<FeedPost>(`/posts/${id}`)
  return data
}

export async function createPostRequest(input: CreatePostInput): Promise<FeedPost> {
  const { data } = await api.post<FeedPost>('/posts', input)
  return data
}

export async function repostRequest(id: string, input: RepostInput): Promise<FeedPost> {
  const { data } = await api.post<FeedPost>(`/posts/${id}/repost`, input)
  return data
}

export async function deletePostRequest(id: string): Promise<void> {
  await api.delete(`/posts/${id}`)
}

export async function pinPostRequest(id: string, pinned: boolean): Promise<FeedPost> {
  const { data } = await api.patch<FeedPost>(`/posts/${id}/pin`, { pinned })
  return data
}

export async function addReactionRequest(id: string, emoji: string): Promise<void> {
  await api.post(`/posts/${id}/reactions`, { emoji })
}

export async function removeReactionRequest(id: string, emoji: string): Promise<void> {
  await api.delete(`/posts/${id}/reactions/${encodeURIComponent(emoji)}`)
}

// Засчитать просмотр поста (при открытии в лайтбоксе). Возвращает обновлённое число просмотров.
export async function incrementPostView(id: string): Promise<number> {
  const { data } = await api.post<{ views: number }>(`/posts/${id}/view`)
  return data.views
}

// Presigned-URL к медиа поста (по видимости поста, TTL 15 мин). Файл авторизуется через сам пост.
export async function fetchPostMediaUrl(postId: string, fileId: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/posts/${postId}/media/${fileId}/url`)
  return data.url
}

export async function fetchComments(id: string): Promise<PostComment[]> {
  const { data } = await api.get<PostComment[]>(`/posts/${id}/comments`)
  return data
}

export async function addCommentRequest(
  id: string,
  input: { content: string; parentId?: string },
): Promise<PostComment> {
  const { data } = await api.post<PostComment>(`/posts/${id}/comments`, input)
  return data
}

export async function deleteCommentRequest(id: string, commentId: string): Promise<void> {
  await api.delete(`/posts/${id}/comments/${commentId}`)
}
