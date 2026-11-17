import type { MessageForwardBatchInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { LinkPreview } from '../model/types'

// Ручки черновика поля ввода (Telegram): превью ссылки над полем до отправки и отправка
// пересылки, собранной над полем, — одной пачкой с комментарием.

export const composerDraftKeys = {
  linkPreview: (url: string) => ['chats', 'composer', 'link-preview', url] as const,
}

/**
 * Превью ссылки черновика. Сервер ходит за страницей сам (защита от SSRF — там же), отдаёт
 * заголовок, описание и сайт; картинки нет (F-F29). `null` — превью у ссылки нет.
 */
export async function fetchDraftLinkPreview(
  url: string,
  signal?: AbortSignal,
): Promise<LinkPreview | null> {
  const { data } = await api.get<{ preview: LinkPreview | null }>('/chats/link-preview', {
    params: { url },
    signal,
  })
  return data.preview
}

/** Итог пересылки по одному чату: отказ одного не роняет остальные. */
export interface ForwardBatchResult {
  chatId: string
  ok: boolean
  messageIds: string[]
  code?: string
}

/**
 * Пересылка пачкой (`POST /chats/forward`): сообщения в хронологическом порядке, комментарий
 * — перед ними, как в Telegram. `requestId` — ключ идемпотентности: повтор после обрыва связи
 * не шлёт сообщения второй раз.
 */
export async function forwardBatchRequest(
  input: MessageForwardBatchInput,
): Promise<ForwardBatchResult[]> {
  const { data } = await api.post<{ results: ForwardBatchResult[] }>('/chats/forward', input)
  return data.results
}
