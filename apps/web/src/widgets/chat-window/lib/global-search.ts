import type { MessageSearchKind } from '@studenthub/shared-schemas'
import type { ChatMessage, MessageAttachment } from '../../../entities/chat'

/**
 * Глобальный поиск левой колонки (Telegram: вкладки «Чаты · Медиа · Ссылки · Файлы · Музыка ·
 * Голосовые»). Чистые правила без React: какое вложение к какой вкладке относится, как
 * разложить выдачу сервера на строки и что показать у ссылки.
 */

export type SearchTab = 'chats' | MessageSearchKind
export const SEARCH_TABS: SearchTab[] = ['chats', 'media', 'link', 'file', 'music', 'voice']

/** Подпись вкладки — ключ в пространстве имён `Chats`. */
export const SEARCH_TAB_KEY: Record<SearchTab, string> = {
  chats: 'tgList.searchChats',
  media: 'tgList.searchMedia',
  link: 'tgList.searchLinks',
  file: 'tgList.searchFiles',
  music: 'tgSearch.tabMusic',
  voice: 'tgSearch.tabVoice',
}

/** Имя файла записи с микрофона — так голосовое отличает сервер (chat-search.ts). */
const VOICE_NAME_RE = /^voice-/i

function isVoiceNote(att: MessageAttachment): boolean {
  if (!att.name || !VOICE_NAME_RE.test(att.name)) return false
  return att.mime.startsWith('audio/') || att.mime.startsWith('video/')
}

const isImageOrVideo = (mime: string): boolean =>
  mime.startsWith('image/') || mime.startsWith('video/')

/**
 * Относится ли вложение к вкладке — ровно по правилам сервера (`searchKindFileWhere`):
 * сервер находит сообщение, а показать в нём нужно только вложения этого вида (в альбоме
 * из снимка и документа вкладка «Файлы» не должна рисовать снимок).
 */
export function attachmentMatchesKind(
  att: MessageAttachment,
  kind: Exclude<MessageSearchKind, 'link'>,
): boolean {
  const voice = isVoiceNote(att)
  switch (kind) {
    case 'voice':
      return voice
    case 'music':
      return !voice && att.mime.startsWith('audio/')
    case 'media':
      return !voice && !att.asDocument && isImageOrVideo(att.mime)
    case 'file':
      return (
        !voice && (!!att.asDocument || !(isImageOrVideo(att.mime) || att.mime.startsWith('audio/')))
      )
  }
}

/** Строка выдачи вкладки с вложениями: само вложение и сообщение, к которому ведёт переход. */
export interface AttachmentHit {
  message: ChatMessage
  attachment: MessageAttachment
}

/** Разложить найденные сообщения на вложения вкладки, в порядке выдачи (свежие первыми). */
export function attachmentHits(
  messages: readonly ChatMessage[],
  kind: Exclude<MessageSearchKind, 'link'>,
): AttachmentHit[] {
  return messages.flatMap((message) =>
    (message.media ?? [])
      .filter((attachment) => attachmentMatchesKind(attachment, kind))
      .map((attachment) => ({ message, attachment })),
  )
}

const URL_RE = /https?:\/\/[^\s<>()]+/i

export interface LinkHit {
  message: ChatMessage
  url: string
  title: string | null
  site: string | null
}

/** Первая ссылка сообщения: превью сервера или адрес из текста (превью могло не собраться). */
export function linkOf(m: ChatMessage): Omit<LinkHit, 'message'> | null {
  if (m.linkPreview) {
    return { url: m.linkPreview.url, title: m.linkPreview.title, site: m.linkPreview.siteName }
  }
  const found = URL_RE.exec(m.content ?? '')
  return found ? { url: found[0], title: null, site: null } : null
}

export function linkHits(messages: readonly ChatMessage[]): LinkHit[] {
  return messages.flatMap((message) => {
    const link = linkOf(message)
    return link ? [{ message, ...link }] : []
  })
}

/** Домен без `www.` — подпись ссылки без заголовка. Не адрес — как есть. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Длительность записи «м:сс» (час и больше — «ч:мм:сс»). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
