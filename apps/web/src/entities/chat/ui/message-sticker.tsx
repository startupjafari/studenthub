'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { chatKeys, fetchStickerUrl } from '../api/chat-api'
import type { MessageSticker } from '../model/types'

/** Сторона стикера в пузыре, px: каталог рисуется квадратом этой стороны, как в Telegram. */
const STICKER_SIZE = 160

/**
 * Стикер каталога: картинка по подписанной ссылке. Ссылку перезапрашиваем раньше её срока —
 * подпись живёт 10–15 минут (BACKEND_RULES §8).
 */
export function MessageStickerView({ sticker }: { sticker: MessageSticker }) {
  const t = useTranslations('Chats')
  const link = useQuery({
    queryKey: chatKeys.stickerUrl(sticker.id),
    queryFn: () => fetchStickerUrl(sticker.id),
    staleTime: 5 * 60 * 1000,
  })
  const ratio = sticker.width && sticker.height ? sticker.width / sticker.height : 1
  const width = ratio >= 1 ? STICKER_SIZE : Math.round(STICKER_SIZE * ratio)
  const height = ratio >= 1 ? Math.round(STICKER_SIZE / ratio) : STICKER_SIZE
  const alt = sticker.emoji ? `${t('previewSticker')} ${sticker.emoji}` : t('previewSticker')
  if (!link.data) {
    return (
      <div
        className="rounded-xl bg-muted/40"
        style={{ width, height }}
        role="img"
        aria-label={alt}
      />
    )
  }
  return (
    // Подписанная ссылка на приватный бакет — обычный img: next/image её не оптимизирует.
    <img
      src={link.data.url}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      className="object-contain"
    />
  )
}
