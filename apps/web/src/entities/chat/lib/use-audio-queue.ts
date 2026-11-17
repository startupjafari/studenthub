'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { MediaLink } from '../../../shared/api'
import { useAttachmentLinkSource } from '../ui/attachment-link-source'
import type { ChatMediaItem, ChatMessage } from '../model/types'
import { isVoice } from './attachment-kind'
import {
  isVoiceRecording,
  playAudioTrack,
  setAudioQueue,
  toggleAudio,
  useAudioPlayer,
  type AudioTrack,
} from './audio-player'

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

/** Автор в списке правой панели: «Фамилия Имя», как в шапке и пузырях. */
function authorOf(item: ChatMediaItem): string | null {
  return item.sender ? `${item.sender.lastName} ${item.sender.firstName}`.trim() : null
}

/**
 * Список голосовых или музыки правой панели как очередь общего плеера. Запуск из панели
 * играет тем же звуком, что и лента (второй плеер одновременно не заиграет), панель под
 * шапкой показывает трек, а «следующее» идёт вниз по списку панели — как он и читается.
 *
 * `key` — свой ключ очереди: у списка панели порядок другой, чем у истории чата.
 * Возвращает нажатие на строку: свой трек — пауза и продолжение, чужой — запуск.
 */
export function usePlaylistQueue(
  key: string,
  chatId: string,
  items: readonly ChatMediaItem[],
  fallbackTitle: string,
): (id: string) => void {
  const qc = useQueryClient()
  const source = useAttachmentLinkSource()
  const player = useAudioPlayer()

  const tracks = useMemo<AudioTrack[]>(
    () =>
      items.map((it) => {
        const voice = isVoiceRecording(it)
        const author = authorOf(it)
        return {
          id: it.id,
          chatId,
          messageId: it.messageId,
          voice,
          title: voice ? (author ?? fallbackTitle) : (it.name ?? author ?? fallbackTitle),
          performer: voice ? null : author,
          createdAt: it.createdAt,
          duration: it.durationMs ? it.durationMs / 1000 : undefined,
          queueKey: key,
        }
      }),
    [items, chatId, key, fallbackTitle],
  )

  useEffect(() => {
    setAudioQueue(key, tracks, (id) =>
      qc
        .fetchQuery({
          queryKey: [source.scope, id],
          queryFn: () => source.fetch(id),
          staleTime: URL_STALE_MS,
          gcTime: URL_GC_MS,
        })
        .then((link) => link.url),
    )
  }, [key, tracks, qc, source])

  const currentId = player.track?.id
  return useCallback(
    (id: string) => {
      if (currentId === id) {
        toggleAudio()
        return
      }
      const track = tracks.find((t) => t.id === id)
      if (!track) return
      // Ссылка уже в кэше (строку слушали недавно) — отдаём её сразу: тогда play() идёт
      // прямо из нажатия, и iOS не глушит первый звук.
      const cached = qc.getQueryData<MediaLink>([source.scope, id])
      playAudioTrack(cached?.url ? { ...track, url: cached.url } : track)
    },
    [currentId, tracks, qc, source],
  )
}
