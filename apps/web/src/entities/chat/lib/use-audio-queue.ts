'use client'

import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAttachmentLinkSource } from '../ui/attachment-link-source'
import type { ChatMessage } from '../model/types'
import { isVoice } from './attachment-kind'
import { isVoiceRecording, setAudioQueue, type AudioTrack } from './audio-player'

/** Ссылка на вложение живёт 15 минут — тот же ключ и срок, что у пузыря и просмотрщика. */
const URL_STALE_MS = 10 * 60 * 1000
const URL_GC_MS = 15 * 60 * 1000

/**
 * Отдать общему аудиоплееру голосовые и музыку загруженной истории чата — по порядку, как
 * они идут в переписке. По ним работают «следующее» после конца записи и кнопки ◀ ▶ панели.
 *
 * `senderName` — как подписывать автора (тем же видом, что в пузырях).
 */
export function useAudioQueue(
  chatId: string | null,
  messages: readonly ChatMessage[] | undefined,
  senderName: (m: ChatMessage) => string,
): void {
  const qc = useQueryClient()
  const source = useAttachmentLinkSource()

  const tracks = useMemo<AudioTrack[]>(() => {
    const out: AudioTrack[] = []
    for (const m of messages ?? []) {
      // Ещё не доехавшее сообщение играть нечем: файла на сервере пока нет.
      if (m.id.startsWith('tmp:')) continue
      for (const att of m.media) {
        if (!isVoice(att) || att.uploading) continue
        const voice = isVoiceRecording(att)
        const author = senderName(m)
        out.push({
          id: att.id,
          chatId: m.chatId,
          messageId: m.id,
          voice,
          title: voice ? author : (att.name ?? author),
          performer: voice ? null : author,
          createdAt: m.createdAt,
          url: att.localUrl,
          duration: att.durationMs ? att.durationMs / 1000 : undefined,
        })
      }
    }
    return out
    // senderName — функция формата, а не данные: пересобирать очередь из-за её
    // идентичности незачем.
  }, [messages])

  useEffect(() => {
    if (!chatId) return
    setAudioQueue(chatId, tracks, (id) =>
      qc
        .fetchQuery({
          queryKey: [source.scope, id],
          queryFn: () => source.fetch(id),
          staleTime: URL_STALE_MS,
          gcTime: URL_GC_MS,
        })
        .then((link) => link.url),
    )
  }, [chatId, tracks, qc, source])
}
