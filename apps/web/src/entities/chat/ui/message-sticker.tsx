'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AnimatedImage } from '../../../shared/ui'
import { chatKeys, fetchStickerUrl } from '../api/chat-api'
import type { MessageSticker } from '../model/types'

/** Сторона стикера в пузыре, px: каталог рисуется квадратом этой стороны, как в Telegram. */
const STICKER_SIZE = 160

/**
 * Стикер каталога или своего набора: картинка по подписанной ссылке. Ссылку перезапрашиваем
 * раньше её срока — подпись живёт 10–15 минут (BACKEND_RULES §8). Анимированный WebP играет
 * сам; при «уменьшении движения» — первый кадр.
 *
 * `onOpen` — нажатие открывает набор стикера (как в Telegram): из окна набора его можно
 * добавить себе.
 */
export function MessageStickerView({
  sticker,
  onOpen,
}: {
  sticker: MessageSticker
  onOpen?: () => void
}) {
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
  const image = (
    // Подписанная ссылка на приватный бакет — обычный img: next/image её не оптимизирует.
    <AnimatedImage
      src={link.data.url}
      animated={!!sticker.animated}
      alt={onOpen ? '' : alt}
      width={width}
      height={height}
      loading="lazy"
      draggable={false}
      className="object-contain"
    />
  )
  if (!onOpen) return image
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      aria-label={t('tgStickers.openSet', { sticker: alt })}
      className="block cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {image}
    </button>
  )
}
