'use client'

import { MediaViewer } from '../../../shared/ui'
import type { ProfileMedia } from '../../../entities/profile-content'

interface MediaLightboxProps {
  items: ProfileMedia[]
  index: number
  onClose: () => void
  onIndex: (i: number) => void
}

// Просмотр медиа профиля — единый вьюер (как в чате): навигация ◀▶, поворот, скачивание,
// счётчик, закрытие по Esc/фону. Тонкая обёртка над общим shared/ui MediaViewer.
export function MediaLightbox({ items, index, onClose, onIndex }: MediaLightboxProps) {
  const cur = items[index]
  return (
    <MediaViewer
      items={items.map((m) => ({ mime: m.type === 'VIDEO' ? 'video/mp4' : 'image/jpeg' }))}
      index={index}
      src={cur?.url}
      // Копия по размеру экрана, заглушка и HLS с постером — от медиа-системы.
      media={
        cur && {
          placeholder: cur.placeholder,
          width: cur.width,
          height: cur.height,
          sources: cur.sources,
          poster: cur.poster,
          hls: cur.hls,
        }
      }
      onIndexChange={onIndex}
      onClose={onClose}
    />
  )
}
