import { needsMultipartUpload, putPresigned, uploadResumable } from '../../../shared/api'
import type { ChatMessage } from '../model/types'
import {
  chatAttachmentPartUrls,
  presignChatAttachment,
  sendMessageWithUploaded,
  startChatAttachmentMultipart,
} from './chat-api'

/** Поля сообщения, уходящего с файлами прямой загрузкой. */
export interface DirectSendFields {
  content?: string
  replyToId?: string
  replyQuote?: string
  silent?: boolean
  asFiles?: boolean
  /** Номера вложений под спойлером в порядке отправки. */
  spoilerIndexes?: number[]
}

/**
 * Сообщение с файлами больше порога буферной загрузки: файлы идут прямо в хранилище мимо API
 * (одиночный PUT, от 50 МБ — многочастная загрузка с докачкой), а сообщение отправляется
 * следом с ключами объектов — сервер сам соберёт многочастные и привяжет файлы к пузырю.
 *
 * Членство в чате проверяется на каждом шаге, поэтому пара presign/multipart своя, чатовая.
 * Этим путём шлёт и окно чата, и окно обращения поддержки.
 */
export async function sendMessageWithDirectUpload(
  chatId: string,
  fields: DirectSendFields,
  files: File[],
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<ChatMessage> {
  const total = files.reduce((sum, f) => sum + f.size, 0)
  const sent = new Map<number, number>()
  const report = (): void => {
    let done = 0
    for (const value of sent.values()) done += value
    opts.onProgress?.(total > 0 ? Math.min(1, done / total) : 0)
  }

  const attachments: {
    key: string
    uploadId?: string
    name?: string
    spoiler?: boolean
    parts?: { part: number; etag: string }[]
  }[] = []

  // Последовательно, а не параллельно: внутри многочастной загрузки и так три части в
  // работе, и запускать пять таких одновременно значит забить канал и замедлить всё.
  for (const [i, file] of files.entries()) {
    const spoiler = fields.spoilerIndexes?.includes(i)
    const onProgress = (f: number): void => {
      sent.set(i, f * file.size)
      report()
    }

    if (needsMultipartUpload(file.size)) {
      const parts: { part: number; etag: string }[] = []
      const target = await uploadResumable<{ key: string; uploadId: string }>({
        file,
        bucket: 'CHAT',
        start: (mime, size) => startChatAttachmentMultipart(chatId, mime, size),
        urls: (range) => chatAttachmentPartUrls(chatId, range),
        // Сборку делает сервер на отправке сообщения — она же привязывает файл к пузырю.
        // Отдельным шагом объект собрался бы раньше сообщения и остался сиротой, если бы
        // отправка не дошла.
        complete: async (input) => {
          parts.push(...input.parts)
          return { key: input.key, uploadId: input.uploadId }
        },
        onProgress,
        signal: opts.signal,
      })
      attachments.push({
        key: target.key,
        uploadId: target.uploadId,
        name: file.name,
        spoiler,
        parts,
      })
    } else {
      const presigned = await presignChatAttachment(chatId, file.type || 'application/octet-stream')
      await putPresigned(presigned.url, file, onProgress, opts.signal)
      attachments.push({ key: presigned.key, name: file.name, spoiler })
    }
    sent.set(i, file.size)
    report()
  }

  return sendMessageWithUploaded(chatId, {
    content: fields.content,
    replyToId: fields.replyToId,
    replyQuote: fields.replyQuote,
    silent: fields.silent,
    asFiles: fields.asFiles,
    attachments,
  })
}
