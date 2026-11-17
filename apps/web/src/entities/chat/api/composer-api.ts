import type { ChatChecklistCreateInput, ScheduleMessageInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ChatMessage } from '../model/types'

// Ручки поля ввода в духе Telegram: стикеры и GIF из панели символов, чек-лист из меню
// скрепки, отложенная отправка из меню кнопки «Отправить». Отдельным файлом от chat-api:
// у поля ввода свой набор ключей кэша, и он не пересекается с лентой и списком чатов.

export const composerKeys = {
  stickerSets: () => ['chats', 'composer', 'sticker-sets'] as const,
  stickerFavorites: () => ['chats', 'composer', 'sticker-favorites'] as const,
  gifsRecent: () => ['chats', 'composer', 'gifs-recent'] as const,
  gifsTrending: () => ['chats', 'composer', 'gifs-trending'] as const,
  gifsSearch: (q: string) => ['chats', 'composer', 'gifs-search', q] as const,
  scheduled: (chatId: string) => ['chats', chatId, 'scheduled'] as const,
}

/** Стикер каталога: подписанная ссылка на картинку и срок её жизни. */
export interface CatalogSticker {
  id: string
  emoji: string | null
  width: number | null
  height: number | null
  url: string
  expiresAt: string
}

export interface StickerSet {
  id: string
  title: string
  slug: string
  stickers: CatalogSticker[]
}

export async function fetchStickerSets(): Promise<StickerSet[]> {
  const { data } = await api.get<StickerSet[]>('/chats/stickers/sets')
  return data
}

export async function fetchFavoriteStickers(): Promise<CatalogSticker[]> {
  const { data } = await api.get<CatalogSticker[]>('/chats/stickers/favorites')
  return data
}

export async function addFavoriteStickerRequest(stickerId: string): Promise<void> {
  await api.post(`/chats/stickers/favorites/${stickerId}`)
}

export async function removeFavoriteStickerRequest(stickerId: string): Promise<void> {
  await api.delete(`/chats/stickers/favorites/${stickerId}`)
}

/** Ответ на стикер, GIF и чек-лист: необязательный `replyToId`, как у обычного сообщения. */
export interface RichSendFields {
  replyToId?: string
}

export async function sendStickerRequest(
  chatId: string,
  stickerId: string,
  fields: RichSendFields = {},
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/sticker`, {
    stickerId,
    ...fields,
  })
  return data
}

/** GIF внешнего каталога в выдаче поиска: размеры оригинала и маленькая копия для сетки. */
export interface CatalogGif {
  id: string
  title: string
  width: number
  height: number
  previewUrl: string
  previewWidth: number
  previewHeight: number
}

export interface CatalogGifPage {
  items: CatalogGif[]
  nextOffset: number | null
}

/** GIF, которые я уже отправлял: файл чата, а не запись каталога. */
export interface RecentGif {
  fileId: string
  width: number | null
  height: number | null
  url: string
  expiresAt: string
}

export async function fetchTrendingGifs(offset = 0): Promise<CatalogGifPage> {
  const { data } = await api.get<CatalogGifPage>('/chats/gifs/trending', { params: { offset } })
  return data
}

export async function searchGifs(q: string, offset = 0): Promise<CatalogGifPage> {
  const { data } = await api.get<CatalogGifPage>('/chats/gifs/search', { params: { q, offset } })
  return data
}

export async function fetchRecentGifs(): Promise<RecentGif[]> {
  const { data } = await api.get<RecentGif[]>('/chats/gifs/recent', { params: { limit: 30 } })
  return data
}

/** GIF каталога: сервер сам скачивает оригинал по id и хранит копию вложением чата. */
export async function sendCatalogGifRequest(
  chatId: string,
  id: string,
  fields: RichSendFields = {},
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/gif/external`, {
    provider: 'giphy',
    id,
    ...fields,
  })
  return data
}

/** Повторная отправка своего GIF — по файлу, который уже лежит в чате. */
export async function sendRecentGifRequest(
  chatId: string,
  fileId: string,
  fields: RichSendFields = {},
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/gif`, { fileId, ...fields })
  return data
}

export async function sendChecklistRequest(
  chatId: string,
  input: ChatChecklistCreateInput,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/checklist`, input)
  return data
}

/** Отложенное сообщение: видно только отправителю, до отправки его можно отменить. */
export interface ScheduledMessage {
  id: string
  chatId: string
  content: string
  replyToId: string | null
  replyQuote: string | null
  silent: boolean
  scheduledAt: string
  createdAt: string
}

export async function fetchScheduledMessages(chatId: string): Promise<ScheduledMessage[]> {
  const { data } = await api.get<ScheduledMessage[]>(`/chats/${chatId}/scheduled`)
  return data
}

export async function scheduleMessageRequest(
  chatId: string,
  input: ScheduleMessageInput,
): Promise<ScheduledMessage> {
  const { data } = await api.post<ScheduledMessage>(`/chats/${chatId}/scheduled`, input)
  return data
}

export async function cancelScheduledRequest(id: string): Promise<void> {
  await api.delete(`/chats/scheduled/${id}`)
}

export async function sendScheduledNowRequest(id: string): Promise<void> {
  await api.post(`/chats/scheduled/${id}/send-now`)
}
