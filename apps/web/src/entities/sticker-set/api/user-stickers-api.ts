import type { UserStickerSetCreateInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

// Свои стикеры (docs/PROJECT.md «Свои стикеры»): личные наборы, наборы в панели и превью по
// ссылке `/addstickers/<slug>`. Каталог платформы — `/chats/stickers/sets` (entities/chat).

/** Стикер в панели и в превью: подписанная ссылка на WebP 512 и её срок. */
export interface PanelSticker {
  id: string
  emoji: string | null
  width: number | null
  height: number | null
  /** Анимированный WebP (из GIF или видео). */
  animated: boolean
  url: string
  expiresAt: string
}

/** Стикер своего набора: пока воркер собирает анимацию — PROCESSING и без ссылки. */
export interface MySticker {
  id: string
  emoji: string | null
  width: number | null
  height: number | null
  animated: boolean
  status: 'PROCESSING' | 'READY' | 'FAILED'
  url: string | null
  expiresAt: string | null
}

export interface MyStickerSet {
  id: string
  title: string
  slug: string
  /** Снят модерацией: виден только владельцу, пополнять нельзя. */
  removed: boolean
  createdAt: string
  stickers: MySticker[]
}

/** Личный набор в панели стикеров (свой или чужой по ссылке). */
export interface AddedStickerSet {
  id: string
  title: string
  slug: string
  isMine: boolean
  stickers: PanelSticker[]
}

export interface StickerSetPreview {
  id: string
  title: string
  slug: string
  kind: 'CATALOG' | 'USER'
  isMine: boolean
  /** Уже в панели (у каталога — всегда). */
  isAdded: boolean
  stickers: PanelSticker[]
}

export type StickerSetPreviewQuery = { slug: string } | { setId: string }

export const userStickerKeys = {
  all: ['user-stickers'] as const,
  mine: () => ['user-stickers', 'mine'] as const,
  added: () => ['user-stickers', 'added'] as const,
  preview: (q: StickerSetPreviewQuery) =>
    ['user-stickers', 'preview', 'slug' in q ? `s:${q.slug}` : `i:${q.setId}`] as const,
}

export async function fetchMyStickerSets(): Promise<MyStickerSet[]> {
  const { data } = await api.get<MyStickerSet[]>('/chats/stickers/mine')
  return data
}

export async function fetchMyStickerSet(setId: string): Promise<MyStickerSet> {
  const { data } = await api.get<MyStickerSet>(`/chats/stickers/mine/${setId}`)
  return data
}

export async function createMyStickerSetRequest(
  input: UserStickerSetCreateInput,
): Promise<MyStickerSet> {
  const { data } = await api.post<MyStickerSet>('/chats/stickers/mine', input)
  return data
}

export async function renameMyStickerSetRequest(
  setId: string,
  title: string,
): Promise<MyStickerSet> {
  const { data } = await api.patch<MyStickerSet>(`/chats/stickers/mine/${setId}`, { title })
  return data
}

export async function deleteMyStickerSetRequest(setId: string): Promise<void> {
  await api.delete(`/chats/stickers/mine/${setId}`)
}

/** Что уходит на сервер вместе с исходником (см. UserStickerUploadFieldsSchema). */
export interface StickerUploadInput {
  /** Файл с устройства: готовая картинка (PNG из редактора) или исходник GIF/видео. */
  file?: Blob
  /** Вместо файла — вложение переписки (видео и GIF не грузятся заново). */
  sourceFileId?: string
  /** Прозрачный PNG с надписью поверх анимации. */
  overlay?: Blob
  emoji?: string
  startMs?: number
  durationMs?: number
  crop?: { x: number; y: number; w: number; h: number }
}

export async function addStickerRequest(
  setId: string,
  input: StickerUploadInput,
): Promise<MyStickerSet> {
  const form = new FormData()
  const num = (v: number) => String(Math.round(v * 10_000) / 10_000)
  if (input.emoji) form.append('emoji', input.emoji)
  if (input.sourceFileId) form.append('sourceFileId', input.sourceFileId)
  if (input.startMs !== undefined) form.append('startMs', String(Math.round(input.startMs)))
  if (input.durationMs !== undefined) {
    form.append('durationMs', String(Math.round(input.durationMs)))
  }
  if (input.crop) {
    form.append('cropX', num(input.crop.x))
    form.append('cropY', num(input.crop.y))
    form.append('cropW', num(input.crop.w))
    form.append('cropH', num(input.crop.h))
  }
  if (input.file) form.append('file', input.file, 'sticker')
  if (input.overlay) form.append('overlay', input.overlay, 'overlay.png')
  const { data } = await api.post<MyStickerSet>(`/chats/stickers/mine/${setId}/stickers`, form)
  return data
}

export async function deleteMyStickerRequest(
  setId: string,
  stickerId: string,
): Promise<MyStickerSet> {
  const { data } = await api.delete<MyStickerSet>(
    `/chats/stickers/mine/${setId}/stickers/${stickerId}`,
  )
  return data
}

export async function reorderMyStickersRequest(
  setId: string,
  stickerIds: string[],
): Promise<MyStickerSet> {
  const { data } = await api.put<MyStickerSet>(`/chats/stickers/mine/${setId}/order`, {
    stickerIds,
  })
  return data
}

export async function fetchAddedStickerSets(): Promise<AddedStickerSet[]> {
  const { data } = await api.get<AddedStickerSet[]>('/chats/stickers/added')
  return data
}

export async function addStickerSetRequest(setId: string): Promise<void> {
  await api.post(`/chats/stickers/added/${setId}`)
}

export async function removeStickerSetRequest(setId: string): Promise<void> {
  await api.delete(`/chats/stickers/added/${setId}`)
}

export async function fetchStickerSetPreview(
  query: StickerSetPreviewQuery,
): Promise<StickerSetPreview> {
  const { data } = await api.get<StickerSetPreview>('/chats/stickers/preview', { params: query })
  return data
}

/** Адрес страницы набора: его копируют в «Поделиться». */
export function stickerSetLink(slug: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/addstickers/${encodeURIComponent(slug)}`
}
