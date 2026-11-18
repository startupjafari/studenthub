'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useRealtimeEvent } from '../../../shared/realtime'
import {
  SAVED_GIFS_CHANGED_EVENT,
  fetchSavedGifs,
  gifFingerprintOf,
  gifKeys,
  removeSavedGifRequest,
  saveGifRequest,
  type SavedGif,
} from '../api/gifs-api'
import type { MessageAttachment } from '../model/types'
import { isGif } from './attachment-kind'

// Ссылки в списке подписаны на 15 минут: держим выдачу свежей десять.
const SAVED_STALE_MS = 10 * 60 * 1000

/**
 * «Мои GIF». Список синхронизируется между устройствами: сервер шлёт `gifs:saved-changed`
 * своему пользователю после каждого сохранения и удаления — где бы оно ни случилось.
 */
export function useSavedGifs(enabled = true) {
  const qc = useQueryClient()
  useRealtimeEvent(SAVED_GIFS_CHANGED_EVENT, () => {
    void qc.invalidateQueries({ queryKey: gifKeys.saved() })
  })
  return useQuery({
    queryKey: gifKeys.saved(),
    queryFn: fetchSavedGifs,
    staleTime: SAVED_STALE_MS,
    enabled,
  })
}

/** Сохранённая запись этого вложения: то же вложение или тот же GIF из другой пересылки. */
export function findSavedGif(
  saved: readonly SavedGif[],
  att: Pick<MessageAttachment, 'id' | 'size' | 'width' | 'height'>,
): SavedGif | undefined {
  const fingerprint = gifFingerprintOf(att)
  return saved.find((g) => g.sourceFileId === att.id || g.fingerprint === fingerprint)
}

/** Сохранить и убрать — с подтверждением тостом, как избранные стикеры. */
export function useSavedGifActions() {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const fail = (e: unknown): void => {
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  }
  const save = useMutation({
    mutationFn: saveGifRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gifKeys.saved() })
      toast.success(t('tgGifs.savedToast'))
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: removeSavedGifRequest,
    // Плитка пропадает сразу, не дожидаясь ответа: так же ведёт себя Telegram.
    onMutate: (id: string) => {
      qc.setQueryData<SavedGif[]>(gifKeys.saved(), (list) => list?.filter((g) => g.id !== id))
    },
    onSuccess: () => toast.success(t('tgGifs.removedToast')),
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: gifKeys.saved() })
      fail(e)
    },
  })
  return { save, remove }
}

/** Пункт меню сообщения с GIF: «Сохранить в GIF» или «Убрать из GIF». */
export interface SavedGifMenuItem {
  saved: boolean
  onToggle: () => void
}

/**
 * Пункт «Сохранить в GIF» / «Убрать из GIF» для меню сообщения. `undefined` — в сообщении
 * нет GIF (или он ещё не доехал до сервера): пункта нет.
 */
export function useSavedGifMenu(): (message: {
  id: string
  media?: readonly MessageAttachment[]
}) => SavedGifMenuItem | undefined {
  const saved = useSavedGifs()
  const { save, remove } = useSavedGifActions()
  return (message) => {
    if (message.id.startsWith('tmp')) return undefined
    const att = (message.media ?? []).find(
      (a) => isGif(a) && !a.uploading && !a.id.startsWith('tmp'),
    )
    if (!att) return undefined
    const match = findSavedGif(saved.data ?? [], att)
    return {
      saved: !!match,
      onToggle: () => (match ? remove.mutate(match.id) : save.mutate(att.id)),
    }
  }
}
