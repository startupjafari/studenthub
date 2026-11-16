import type { StickerSetCreateInput, StickerSetUpdateInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

/** Стикер набора в админке: картинка — подписанная ссылка со сроком `expiresAt` (10–15 мин). */
export interface AdminSticker {
  id: string
  emoji: string | null
  width: number | null
  height: number | null
  url: string
  expiresAt: string
}

/** Набор стикеров в админке: ещё и неопубликованные, с порядком и флагом публикации. */
export interface AdminStickerSet {
  id: string
  title: string
  slug: string
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
  stickers: AdminSticker[]
}

export const stickerSetKeys = {
  all: ['sticker-sets'] as const,
  admin: () => ['sticker-sets', 'admin'] as const,
}

// Каталог стикеров чатов (docs/PROJECT.md «Стикеры»): только PLATFORM_ADMIN.
export async function fetchAdminStickerSets(): Promise<AdminStickerSet[]> {
  const { data } = await api.get<AdminStickerSet[]>('/admin/sticker-sets')
  return data
}

/** Новый набор создаётся неопубликованным. Занятый slug — 409 CONFLICT. */
export async function createStickerSetRequest(
  input: StickerSetCreateInput,
): Promise<AdminStickerSet> {
  const { data } = await api.post<AdminStickerSet>('/admin/sticker-sets', input)
  return data
}

export async function updateStickerSetRequest(
  id: string,
  input: StickerSetUpdateInput,
): Promise<AdminStickerSet> {
  const { data } = await api.patch<AdminStickerSet>(`/admin/sticker-sets/${id}`, input)
  return data
}

/** Удаляет набор вместе с картинками; у отправленных сообщений стикер становится `null`. */
export async function deleteStickerSetRequest(id: string): Promise<void> {
  await api.delete(`/admin/sticker-sets/${id}`)
}

/** Картинка — PNG/WebP/GIF ≤ 512 КБ (сервер проверяет по содержимому), эмодзи — один. */
export async function uploadStickerRequest(
  setId: string,
  file: File,
  emoji?: string,
): Promise<AdminStickerSet> {
  const form = new FormData()
  if (emoji) form.append('emoji', emoji)
  form.append('file', file)
  const { data } = await api.post<AdminStickerSet>(`/admin/sticker-sets/${setId}/stickers`, form)
  return data
}

export async function deleteStickerRequest(
  setId: string,
  stickerId: string,
): Promise<AdminStickerSet> {
  const { data } = await api.delete<AdminStickerSet>(
    `/admin/sticker-sets/${setId}/stickers/${stickerId}`,
  )
  return data
}
