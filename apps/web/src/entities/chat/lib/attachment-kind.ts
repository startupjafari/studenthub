import type { MessageAttachment } from '../model/types'

// Признаки вида вложения. Живут здесь, а не в message-attachments.tsx, потому что нужны
// в двух местах сразу: сообщение решает, чем себя нарисовать, а список чатов — что
// написать в превью. Разъехаться им нельзя: иначе в списке «Фото», а в переписке строка
// файла, и человек ищет снимок, которого там нет.

// Основной признак — имя из встроенного рекордера (`voice-…`), т.к. mime по содержимому
// непредсказуем: webm → video/webm, iOS-запись → video/mp4. Для старых сообщений —
// запасная эвристика по mime.
export function isVoice(att: MessageAttachment): boolean {
  if (att.name && /^voice-/i.test(att.name)) return true
  return att.mime.startsWith('audio/') || att.mime === 'video/webm'
}

// Открывается ли вложение в полноэкранном просмотрщике (картинка или реальное видео, не
// голосовое).
//
// `asDocument` перевешивает mime: снимок, отправленный «без сжатия», получатель видит
// строкой файла — ровно так, как выбрал отправитель. Иначе выбор способа отправки не
// доезжал бы дальше окна отправки, а картинка всё равно приходила бы превью.
export function isViewable(att: MessageAttachment): boolean {
  if (isVoice(att) || att.asDocument) return false
  return att.mime.startsWith('image/') || att.mime.startsWith('video/')
}

/** Как вложение называется в превью списка чатов. */
export type AttachmentKind = 'voice' | 'photo' | 'video' | 'file'

export function attachmentKind(att: MessageAttachment): AttachmentKind {
  if (isVoice(att)) return 'voice'
  if (!isViewable(att)) return 'file'
  return att.mime.startsWith('video/') ? 'video' : 'photo'
}

/**
 * Чем подписать сообщение с вложениями в списке чатов — как в Telegram: «Фото»,
 * «Видео», «Голосовое сообщение», «Файл», во множественном числе при альбоме.
 *
 * Разнородный набор сводим к «файлам»: «3 фото» про альбом из снимка, ролика и архива
 * было бы враньём, а перечислять виды в строке, которая и так обрезается, негде.
 */
export function mediaPreview(
  media: readonly MessageAttachment[],
): { kind: AttachmentKind; count: number } | null {
  const first = media[0]
  if (!first) return null
  const kind = attachmentKind(first)
  const uniform = media.every((a) => attachmentKind(a) === kind)
  return { kind: uniform ? kind : 'file', count: media.length }
}
