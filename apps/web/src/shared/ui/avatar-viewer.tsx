'use client'

import { useTranslations } from 'next-intl'
import { MediaViewer } from './media-viewer'

/**
 * Фото профиля во весь экран (как в Telegram по нажатию на аватар): общий просмотрщик с
 * именем и «N из M» в шапке, листанием, зумом, поворотом и скачиванием.
 *
 * `photos` — по порядку, текущее первым. Истории аватаров сервер пока не хранит, поэтому
 * обычно это текущий аватар (у собеседника в чате — ещё и обложка профиля); появится
 * история — её снимки просто идут следом.
 */
export function AvatarViewer({
  photos,
  name,
  index,
  onIndexChange,
  onClose,
  getOrigin,
}: {
  photos: readonly string[]
  /** Чьё фото: имя в шапке и имя файла при скачивании. */
  name: string
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  /** Аватар на экране — из него фото вырастает и в него же садится. */
  getOrigin?: (index: number) => HTMLElement | null
}) {
  const t = useTranslations('Common')
  const src = photos[index]
  if (!src) return null
  const counter =
    photos.length > 1 ? t('tgMedia.counter', { current: index + 1, total: photos.length }) : null
  return (
    <MediaViewer
      items={photos.map(() => ({ mime: 'image/*', name }))}
      index={index}
      src={src}
      onIndexChange={onIndexChange}
      onClose={onClose}
      topLeft={
        <div className="flex min-w-0 flex-col px-1 leading-tight">
          <span className="truncate text-sm font-medium text-white">{name}</span>
          {counter && (
            <span className="truncate text-xs text-white/60 tabular-nums">{counter}</span>
          )}
        </div>
      }
      downloadName={name}
      getOrigin={getOrigin}
    />
  )
}
