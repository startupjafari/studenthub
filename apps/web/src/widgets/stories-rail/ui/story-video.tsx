'use client'

import { useEffect, useRef, useState } from 'react'
import type { StoryMedia } from '../../../entities/story'
import { pickSource, useHls } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Ролик сторис со своим HLS. Окно держит два таких: текущий и следующий (Telegram). Следующий
 * стоит невидимым на паузе в начале и тем временем грузит манифест и первые сегменты; при
 * переходе тот же элемент (ключ — id сторис) становится текущим и играет сразу, без
 * загрузки с нуля.
 *
 * Невидимый — того же размера, что и видимый (`absolute inset-0`), а не нулевой: hls.js
 * выбирает качество по размеру плеера (`capLevelToPlayerSize`), и в окошке 0×0 прогрел бы
 * самый низкий рендишн, который потом пришлось бы сменить.
 */
export function StoryVideo({
  media,
  active,
  muted,
  onActiveElement,
  onProgress,
  onEnded,
  onError,
}: {
  media: StoryMedia
  /** Этот ролик сейчас на экране. Нет — прогрев следующего. */
  active: boolean
  muted: boolean
  /** Элемент текущего ролика — окну для паузы и запуска; `null`, когда ролик перестал быть текущим. */
  onActiveElement: (el: HTMLVideoElement | null) => void
  onProgress: (fraction: number) => void
  onEnded: () => void
  onError: () => void
}) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null)
  useHls(el, media.hls, media.url)
  // Ошибка, случившаяся ещё во время прогрева, — сообщаем, когда ролик стал текущим:
  // повторного события error на нём уже не будет.
  const erroredRef = useRef(false)

  const onActiveElementRef = useRef(onActiveElement)
  onActiveElementRef.current = onActiveElement
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!el) return
    if (!active) {
      // Шаг назад делает текущий ролик «следующим» — к нему вернутся с начала, а не с середины.
      el.pause()
      el.currentTime = 0
      return
    }
    onActiveElementRef.current(el)
    if (erroredRef.current || el.error) onErrorRef.current()
    return () => onActiveElementRef.current(null)
  }, [active, el])

  return (
    <video
      ref={setEl}
      // При HLS источник ставит useHls; иначе — оригинал.
      src={media.hls ? undefined : media.url}
      poster={pickSource(media.poster, 1280)?.url}
      preload="auto"
      playsInline
      // Прогреваемый ролик молчит всегда: звук — только у того, что на экране.
      muted={muted || !active}
      controls={false}
      aria-hidden={active ? undefined : true}
      tabIndex={-1}
      className={cn(
        'size-full object-contain',
        !active && 'pointer-events-none absolute inset-0 opacity-0',
      )}
      onTimeUpdate={(e) => {
        const v = e.currentTarget
        if (active && v.duration > 0) onProgress(v.currentTime / v.duration)
      }}
      onEnded={active ? onEnded : undefined}
      onError={() => {
        if (active) onError()
        else erroredRef.current = true
      }}
    />
  )
}
