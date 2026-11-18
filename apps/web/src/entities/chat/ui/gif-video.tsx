'use client'

import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../../shared/lib'

/**
 * GIF как в Telegram: беззвучный MP4, который играет сам и по кругу, без панели плеера.
 *
 * Играет, только пока виден (IntersectionObserver): лента с десятком GIF иначе держала бы
 * десяток работающих декодеров, а на телефоне это и батарея, и рывки прокрутки. Ушёл с экрана
 * — пауза, вернулся — продолжает.
 *
 * «Уменьшение движения» в системе — не играет сам: виден постер, а посмотреть можно в
 * просмотрщике (там GIF открыли нажатием, и он играет).
 */
export function GifVideo({
  src,
  poster,
  paused = false,
  className,
  onReady,
  onError,
}: {
  src: string
  poster?: string
  /** Держать на паузе и на экране (под спойлером). */
  paused?: boolean
  className?: string
  /** Первый кадр (или постер) готов — можно снимать заглушку. */
  onReady?: () => void
  onError?: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [reduced] = useState(prefersReducedMotion)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const play = visible && !paused && !reduced
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // React выставляет `muted` свойством, но не атрибутом; без звука браузер разрешает
    // автоплей — ставим явно, до play().
    el.muted = true
    if (play) void el.play().catch(() => undefined)
    else el.pause()
  }, [play, src])

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      // Пока не на экране — только заголовок файла: длинная история с GIF не качает их разом.
      preload={visible && !reduced ? 'auto' : 'metadata'}
      disablePictureInPicture
      aria-hidden
      tabIndex={-1}
      onLoadedMetadata={onReady}
      onError={onError}
      className={className}
    />
  )
}
