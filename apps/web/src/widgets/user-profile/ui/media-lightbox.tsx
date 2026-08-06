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
  return (
    <MediaViewer
      items={items.map((m) => ({ mime: m.type === 'VIDEO' ? 'video/mp4' : 'image/jpeg' }))}
      index={index}
      src={items[index]?.url}
      onIndexChange={onIndex}
      onClose={onClose}
    />
  )
}
