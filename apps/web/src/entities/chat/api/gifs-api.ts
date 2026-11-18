import { api } from '../../../shared/api'
import type { RecentGif } from './composer-api'

// «Мои GIF» как в Telegram: GIF, сохранённые из переписки одним касанием. Отдельно от
// composer-api: у сохранённых свой ключ кэша и своё событие синхронизации устройств.

export const gifKeys = {
  saved: () => ['chats', 'composer', 'gifs-saved'] as const,
}

/** Событие своим устройствам: «Мои GIF» изменились — перечитать список. */
export const SAVED_GIFS_CHANGED_EVENT = 'gifs:saved-changed'

/** Сохранённый GIF: плитка панели + своя запись и откуда сохранён. */
export interface SavedGif extends RecentGif {
  /** id записи — для «Убрать из GIF». */
  id: string
  /** Вложение, из которого сохранили: по нему меню сообщения знает «уже сохранён». */
  sourceFileId: string | null
  /** `<size>:<width>:<height>` источника — тот же GIF из другой пересылки. */
  fingerprint: string
  createdAt: string
}

export async function fetchSavedGifs(): Promise<SavedGif[]> {
  const { data } = await api.get<SavedGif[]>('/chats/gifs/saved')
  return data
}

/** Сохранить GIF-вложение сообщения. Повтор того же GIF поднимает его наверх. */
export async function saveGifRequest(fileId: string): Promise<SavedGif> {
  const { data } = await api.post<SavedGif>('/chats/gifs/saved', { fileId })
  return data
}

export async function removeSavedGifRequest(id: string): Promise<void> {
  await api.delete(`/chats/gifs/saved/${id}`)
}

/** Отпечаток вложения в той же форме, что у сервера: узнать уже сохранённый GIF. */
export function gifFingerprintOf(att: {
  size: number
  width?: number | null
  height?: number | null
}): string {
  return `${att.size}:${att.width ?? ''}:${att.height ?? ''}`
}
