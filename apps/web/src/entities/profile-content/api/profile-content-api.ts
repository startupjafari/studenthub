import type { AxiosProgressEvent } from 'axios'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import type {
  ArticleCategory,
  AssignAlbumMediaInput,
  CreateAlbumInput,
  CreateProfileArticleInput,
  UpdateAlbumInput,
  UpdateProfileArticleInput,
} from '@studenthub/shared-schemas'

// Комментарий к контенту профиля (статья/опрос).
export interface ContentComment {
  id: string
  content: string
  createdAt: string
  authorId: string
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}
import { api } from '../../../shared/api'

// Фабрика ключей React Query (docs/FRONTEND_RULES.md §5.5).
export const profileContentKeys = {
  media: (userId: string) => ['profile-content', 'media', userId] as const,
  articles: (userId: string) => ['profile-content', 'articles', userId] as const,
  albums: (userId: string) => ['profile-content', 'albums', userId] as const,
}

export interface ProfileMedia {
  id: string
  type: 'PHOTO' | 'VIDEO'
  mime: string
  size: number
  url: string
  // Обложка видео (выбранный кадр); null — нет обложки или это фото.
  posterUrl: string | null
  albumId: string | null
  createdAt: string
}

export interface Album {
  id: string
  title: string
  coverUrl: string | null
  count: number
  createdAt: string
}

export interface ProfileArticle {
  id: string
  userId: string
  title: string
  description: string | null
  content: string
  coverUrl: string | null
  coverGradient: string | null
  category: ArticleCategory | null
  tags: string[]
  visibility: string
  allowComments: boolean
  status: string
  readingMinutes: number | null
  views: number
  publishedAt: string | null
  commentCount: number
  bookmarksCount: number
  bookmarked: boolean
  createdAt: string
  updatedAt: string
}

// ── Медиа (фото/видео) ─────────────────────────────────────────────────────

export async function fetchProfileMedia(userId: string): Promise<ProfileMedia[]> {
  const { data } = await api.get<ProfileMedia[]>(`/profile/${userId}/media`)
  return data
}

// Прикрепить обложку к видео (выбранный кадр раскадровки). Poster — JPEG-кадр.
export async function attachVideoCover(mediaId: string, poster: File): Promise<ProfileMedia> {
  const form = new FormData()
  form.append('file', poster)
  const { data } = await api.post<ProfileMedia>(`/profile/media/${mediaId}/poster`, form)
  return data
}

export async function uploadProfileMedia(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProfileMedia> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<ProfileMedia>('/profile/media', form, {
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
  return data
}

export async function deleteProfileMedia(fileId: string): Promise<void> {
  await api.delete(`/profile/media/${fileId}`)
}

// Presigned-загрузка крупных медиа (видео >порога): presign → прямой PUT в MinIO → confirm.
async function presignProfileMedia(
  mime: string,
  size: number,
): Promise<{ key: string; url: string }> {
  const { data } = await api.post<{ key: string; url: string }>('/profile/media/presign', {
    mime,
    size,
  })
  return data
}

async function confirmProfileMedia(key: string, mime: string): Promise<ProfileMedia> {
  const { data } = await api.post<ProfileMedia>('/profile/media/confirm', { key, mime })
  return data
}

// Прямая загрузка в MinIO по presigned URL. Отдельный хост хранилища — вне shared/api-инстанса.
async function putToPresignedUrl(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!res.ok) throw new Error(`Ошибка прямой загрузки: ${res.status}`)
}

/**
 * Автовыбор способа загрузки медиа: мелкие файлы — буферно через API, крупные (>порога) —
 * presigned напрямую в MinIO (docs/BACKEND_RULES.md §8).
 */
export async function uploadProfileMediaAuto(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProfileMedia> {
  if (file.size <= FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return uploadProfileMedia(file, onProgress)
  }
  const { key, url } = await presignProfileMedia(file.type, file.size)
  await putToPresignedUrl(url, file)
  return confirmProfileMedia(key, file.type)
}

// Загрузка обложки статьи (изображение) → публичный URL.
export async function uploadArticleCover(file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ url: string }>('/profile/articles/cover', form)
  return data
}

// ── Статьи ──────────────────────────────────────────────────────────────────

export async function fetchProfileArticles(userId: string): Promise<ProfileArticle[]> {
  const { data } = await api.get<ProfileArticle[]>(`/profile/${userId}/articles`)
  return data
}

export async function createProfileArticle(
  input: CreateProfileArticleInput,
): Promise<ProfileArticle> {
  const { data } = await api.post<ProfileArticle>('/profile/articles', input)
  return data
}

export async function updateProfileArticle(
  id: string,
  input: UpdateProfileArticleInput,
): Promise<ProfileArticle> {
  const { data } = await api.patch<ProfileArticle>(`/profile/articles/${id}`, input)
  return data
}

export async function deleteProfileArticle(id: string): Promise<void> {
  await api.delete(`/profile/articles/${id}`)
}

// Засчитать просмотр статьи (при открытии читалки).
export async function incrementArticleView(id: string): Promise<number> {
  const { data } = await api.post<{ views: number }>(`/profile/articles/${id}/view`)
  return data.views
}

// Похожие статьи автора (по категории/тегам).
export async function fetchRelatedArticles(id: string): Promise<ProfileArticle[]> {
  const { data } = await api.get<ProfileArticle[]>(`/profile/articles/${id}/related`)
  return data
}

// ── Альбомы фото ──────────────────────────────────────────────────────────────

export async function fetchAlbums(userId: string): Promise<Album[]> {
  const { data } = await api.get<Album[]>(`/profile/${userId}/albums`)
  return data
}

export async function createAlbum(input: CreateAlbumInput): Promise<Album> {
  const { data } = await api.post<Album>('/profile/albums', input)
  return data
}

export async function updateAlbum(id: string, input: UpdateAlbumInput): Promise<Album> {
  const { data } = await api.patch<Album>(`/profile/albums/${id}`, input)
  return data
}

export async function deleteAlbum(id: string): Promise<void> {
  await api.delete(`/profile/albums/${id}`)
}

export async function assignAlbumMedia(id: string, input: AssignAlbumMediaInput): Promise<void> {
  await api.post(`/profile/albums/${id}/media`, input)
}

export async function removeAlbumMedia(id: string, fileId: string): Promise<void> {
  await api.delete(`/profile/albums/${id}/media/${fileId}`)
}

// ── Комментарии и закладки статей ─────────────────────────────────────────────

export async function fetchArticleComments(id: string): Promise<ContentComment[]> {
  const { data } = await api.get<ContentComment[]>(`/profile/articles/${id}/comments`)
  return data
}

export async function addArticleComment(id: string, content: string): Promise<ContentComment> {
  const { data } = await api.post<ContentComment>(`/profile/articles/${id}/comments`, { content })
  return data
}

export async function deleteArticleComment(id: string, commentId: string): Promise<void> {
  await api.delete(`/profile/articles/${id}/comments/${commentId}`)
}

export async function toggleArticleBookmark(id: string): Promise<boolean> {
  const { data } = await api.post<{ bookmarked: boolean }>(`/profile/articles/${id}/bookmark`)
  return data.bookmarked
}
