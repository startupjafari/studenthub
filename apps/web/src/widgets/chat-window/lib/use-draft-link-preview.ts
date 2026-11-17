'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LINK_PREVIEW_URL_MAX, firstLinkUrl } from '@studenthub/shared-schemas'
import { composerDraftKeys, fetchDraftLinkPreview, type LinkPreview } from '../../../entities/chat'

/**
 * Пауза после набора до запроса превью: ссылку обычно вставляют целиком, а печатают её
 * редко — и тогда на каждый знак ходить к серверу (а ему — на чужой сайт) незачем.
 */
const DEBOUNCE_MS = 450
/** Превью одной ссылки в пределах сессии не меняется — второй раз не спрашиваем. */
const STALE_MS = 30 * 60 * 1000

/**
 * Превью ссылки над полем ввода до отправки (Telegram WebPagePreview). Ссылка — первая
 * http(s) в тексте, той же функцией, что выбирает её сервер для карточки под сообщением.
 *
 * Крестик убирает превью у этой ссылки: сообщение уйдёт с `noLinkPreview`, и карточки под
 * ним не будет. Другая ссылка в тексте — снова своё превью, как в Telegram.
 */
export function useDraftLinkPreview(
  text: string,
  enabled: boolean,
): {
  preview: LinkPreview | null
  dismiss: () => void
  /** Флаг для отправки: превью у этой ссылки закрыто. */
  noLinkPreview: boolean
} {
  const found = enabled ? firstLinkUrl(text) : undefined
  const url = found && found.length <= LINK_PREVIEW_URL_MAX ? found : undefined
  const [settled, setSettled] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    const timer = setTimeout(() => setSettled(url), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [url])

  // Ссылку стёрли — закрытие забывается: вставят ту же снова, превью появится снова.
  if (!url && dismissed !== null) setDismissed(null)

  const ready = !!url && settled === url
  const query = useQuery({
    queryKey: composerDraftKeys.linkPreview(url ?? ''),
    queryFn: ({ signal }) => fetchDraftLinkPreview(url as string, signal),
    enabled: ready && dismissed !== url,
    staleTime: STALE_MS,
    gcTime: STALE_MS,
    // Нет превью (сайт молчит, частный адрес) — это ответ, а не сбой: повторять нечего.
    retry: false,
    refetchOnWindowFocus: false,
  })

  const visible = ready && dismissed !== url ? (query.data ?? null) : null
  return {
    preview: visible,
    dismiss: () => {
      if (url) setDismissed(url)
    },
    noLinkPreview: !!url && dismissed === url,
  }
}
