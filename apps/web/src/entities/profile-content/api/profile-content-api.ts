import type { MediaInfo } from '../../../shared/api'
import type { AxiosProgressEvent } from 'axios'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import type {
  ArticleCategory,
  AssignAlbumMediaInput,
  CreateAlbumInput,
  CreateProfileArticleInput,
  ProfileContentCounts,
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
import { api, type ResponseWithMeta } from '../../../shared/api'

/** Страница обсуждения: свежие сверху, `cursor` — самый старый комментарий страницы. */
export interface ContentCommentsPage {
  items: ContentComment[]
  cursor?: string
  hasNext: boolean
  /** Сколько комментариев всего — для заголовка, не зависит от догруженных страниц. */
  total?: number
}

/**
 * Чей контент: личный профиль пользователя или страница компании (её контент публикуют
 * сотрудники, сервер берёт компанию из токена — `?as=company`).
 */
export interface ContentOwner {
  kind: 'user' | 'company' | 'university'
  id: string
}

/**
 * Идентификатор владельца в ключах кэша. У компании — с префиксом: id пользователя и
 * компании — оба uuid, и без него списки разных владельцев могли бы делить кэш.
 */
export function contentOwnerKey(owner: ContentOwner): string {
  return owner.kind === 'user' ? owner.id : `${owner.kind}:${owner.id}`
}

/** Параметр создания от имени владельца: у личного профиля его нет. */
export function contentOwnerParams(owner?: ContentOwner): { as?: 'company' | 'university' } {
  return owner && owner.kind !== 'user' ? { as: owner.kind } : {}
}

/** Путь списков владельца: `/profile/:userId/…` или `/profile/<company|university>/:id/…`. */
function ownerBase(owner: ContentOwner): string {
  return owner.kind === 'user' ? `/profile/${owner.id}` : `/profile/${owner.kind}/${owner.id}`
}

// Фабрика ключей React Query (docs/FRONTEND_RULES.md §5.5). Аргумент — id пользователя или
// contentOwnerKey(владельца).
export const profileContentKeys = {
  media: (userId: string) => ['profile-content', 'media', userId] as const,
  articles: (userId: string) => ['profile-content', 'articles', userId] as const,
  // Статья целиком (с текстом) — для читалки и редактора; список несёт только плитки.
  article: (id: string) => ['profile-content', 'article', id] as const,
  albums: (userId: string) => ['profile-content', 'albums', userId] as const,
  // Итоги вкладок (фото, видео, статьи, опросы) — когда список дошёл до потолка.
  counts: (userId: string) => ['profile-content', 'counts', userId] as const,
}

// Поля описания медиа (заглушка, копии, постер, HLS) — от медиа-системы; у ответа старого
// API их нет, отсюда Partial.
export interface ProfileMedia extends Partial<MediaInfo> {
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

/** Компания, от чьего имени опубликован контент (страница компании). */
export interface ContentCompany {
  id: string
  name: string
  logoUrl: string | null
}

export interface ProfileArticle {
  id: string
  userId: string
  // Статья страницы компании; null — личная статья.
  companyId?: string | null
  company?: ContentCompany | null
  // Статья страницы университета; null — не страница вуза.
  universityPageId?: string | null
  universityPage?: ContentCompany | null
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
  /** Лайки статьи: сколько всего и стоит ли свой. Нет полей — ответ старого API. */
  likesCount?: number
  liked?: boolean
  createdAt: string
  updatedAt: string
}

/** Плитка статьи из списка профиля — без полного текста (`view=card`). */
export type ProfileArticleCard = Omit<ProfileArticle, 'content'>

// ── Медиа (фото/видео) ─────────────────────────────────────────────────────

export async function fetchProfileMedia(userId: string): Promise<ProfileMedia[]> {
  return fetchOwnerMedia({ kind: 'user', id: userId })
}

export async function fetchOwnerMedia(owner: ContentOwner): Promise<ProfileMedia[]> {
  const { data } = await api.get<ProfileMedia[]>(`${ownerBase(owner)}/media`)
  return data
}

// Настоящие итоги вкладок профиля: списки медиа, статей и опросов приходят с потолком
// (PROFILE_LIST_LIMITS), и их длина у большого профиля — не итог.
export async function fetchProfileCounts(userId: string): Promise<ProfileContentCounts> {
  return fetchOwnerCounts({ kind: 'user', id: userId })
}

export async function fetchOwnerCounts(owner: ContentOwner): Promise<ProfileContentCounts> {
  const { data } = await api.get<ProfileContentCounts>(`${ownerBase(owner)}/counts`)
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
  owner?: ContentOwner,
): Promise<ProfileMedia> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<ProfileMedia>('/profile/media', form, {
    params: contentOwnerParams(owner),
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
  owner?: ContentOwner,
): Promise<{ key: string; url: string }> {
  const { data } = await api.post<{ key: string; url: string }>(
    '/profile/media/presign',
    { mime, size },
    { params: contentOwnerParams(owner) },
  )
  return data
}

async function confirmProfileMedia(
  key: string,
  mime: string,
  owner?: ContentOwner,
): Promise<ProfileMedia> {
  const { data } = await api.post<ProfileMedia>(
    '/profile/media/confirm',
    { key, mime },
    { params: contentOwnerParams(owner) },
  )
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
  owner?: ContentOwner,
): Promise<ProfileMedia> {
  if (file.size <= FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return uploadProfileMedia(file, onProgress, owner)
  }
  const { key, url } = await presignProfileMedia(file.type, file.size, owner)
  await putToPresignedUrl(url, file)
  return confirmProfileMedia(key, file.type, owner)
}

// Загрузка обложки статьи (изображение) → публичный URL.
export async function uploadArticleCover(file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ url: string }>('/profile/articles/cover', form)
  return data
}

// ── Статьи ──────────────────────────────────────────────────────────────────

// Статьи профиля плитками — без полного текста: сотня статей до 20 000 символов превращала
// открытие профиля в мегабайты ради мозаики и цифры на вкладке. Текст — fetchProfileArticle.
export async function fetchProfileArticles(userId: string): Promise<ProfileArticleCard[]> {
  return fetchOwnerArticles({ kind: 'user', id: userId })
}

export async function fetchOwnerArticles(owner: ContentOwner): Promise<ProfileArticleCard[]> {
  const { data } = await api.get<ProfileArticleCard[]>(`${ownerBase(owner)}/articles`, {
    params: { view: 'card' },
  })
  return data
}

// Статья целиком — для читалки и редактора (по видимости смотрящего).
export async function fetchProfileArticle(id: string): Promise<ProfileArticle> {
  const { data } = await api.get<ProfileArticle>(`/profile/articles/${id}`)
  return data
}

export async function createProfileArticle(
  input: CreateProfileArticleInput,
  owner?: ContentOwner,
): Promise<ProfileArticle> {
  const { data } = await api.post<ProfileArticle>('/profile/articles', input, {
    params: contentOwnerParams(owner),
  })
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
  return fetchOwnerAlbums({ kind: 'user', id: userId })
}

export async function fetchOwnerAlbums(owner: ContentOwner): Promise<Album[]> {
  const { data } = await api.get<Album[]>(`${ownerBase(owner)}/albums`)
  return data
}

export async function createAlbum(input: CreateAlbumInput, owner?: ContentOwner): Promise<Album> {
  const { data } = await api.post<Album>('/profile/albums', input, {
    params: contentOwnerParams(owner),
  })
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

// Размер страницы обсуждения статьи; более ранние — по «Показать предыдущие».
const COMMENTS_PAGE_SIZE = 20

// Страница комментариев статьи: свежие сверху, `cursor` — самый старый из пришедших.
export async function fetchArticleComments(
  id: string,
  cursor?: string,
): Promise<ContentCommentsPage> {
  const res = (await api.get<ContentComment[]>(`/profile/articles/${id}/comments`, {
    params: { limit: COMMENTS_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
  })) as ResponseWithMeta & { data: ContentComment[] }
  return {
    items: res.data,
    cursor: res.meta?.cursor,
    hasNext: res.meta?.hasNext ?? false,
    total: res.meta?.total,
  }
}

export async function addArticleComment(id: string, content: string): Promise<ContentComment> {
  const { data } = await api.post<ContentComment>(`/profile/articles/${id}/comments`, { content })
  return data
}

export async function deleteArticleComment(id: string, commentId: string): Promise<void> {
  await api.delete(`/profile/articles/${id}/comments/${commentId}`)
}

/** Лайк статьи или его снятие — идемпотентно; ответ — итоговое состояние и число лайков. */
export async function setArticleLike(
  id: string,
  liked: boolean,
): Promise<{ liked: boolean; likesCount: number }> {
  const url = `/profile/articles/${id}/like`
  const { data } = liked
    ? await api.post<{ liked: boolean; likesCount: number }>(url)
    : await api.delete<{ liked: boolean; likesCount: number }>(url)
  return data
}

export async function toggleArticleBookmark(id: string): Promise<boolean> {
  const { data } = await api.post<{ bookmarked: boolean }>(`/profile/articles/${id}/bookmark`)
  return data.bookmarked
}
