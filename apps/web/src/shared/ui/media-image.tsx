'use client'

import { useCallback, useEffect, useState, type CSSProperties, type Ref } from 'react'
import type { MediaSource } from '../api/media'
import { cn, srcSetOf } from '../lib'

// Картинка медиа-системы: размытая LQIP-заглушка сразу, полная версия — плавно поверх.
//
// Заглушка — data-URI в несколько сотен байт, она приходит в том же ответе, что и список,
// поэтому силуэт и цвета снимка видны раньше первого байта самой картинки. Полную версию
// выбирает браузер по `srcset`/`sizes` из готовых WebP-копий: на телефоне в пузыре чата это
// 640, в просмотрщике на большом экране — 2048 или оригинал. Нет копий (ещё не готовы,
// файл старше медиа-системы) — грузится оригинал, как раньше.
//
// Обёртка задаёт место, картинка его заполняет: размеры держит вызывающий (aspect-ratio,
// фиксированная плитка), иначе до загрузки занимать было бы нечего.

export interface MediaImageData {
  placeholder?: string | null
  sources?: readonly MediaSource[]
  width?: number | null
}

export function MediaImage({
  src,
  media,
  alt,
  sizes,
  fit = 'cover',
  loading = 'lazy',
  className,
  imgClassName,
  style,
  imgStyle,
  imgRef,
  draggable,
  onLoad,
  onError,
  onClick,
}: {
  /** Оригинал: запасной кандидат и последний элемент srcset. Нет — только заглушка. */
  src?: string
  media?: MediaImageData | null
  alt: string
  /** Ширина картинки в раскладке (`(max-width: 640px) 80vw, 320px`) — по ней браузер выбирает копию. */
  sizes?: string
  fit?: 'cover' | 'contain'
  /** `eager` — первый экран (просмотрщик, текущая сторис): ленивость там только задерживает. */
  loading?: 'lazy' | 'eager'
  className?: string
  imgClassName?: string
  style?: CSSProperties
  imgStyle?: CSSProperties
  imgRef?: Ref<HTMLImageElement>
  draggable?: boolean
  onLoad?: () => void
  onError?: () => void
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const srcSet = srcSetOf(media?.sources, src ? { url: src, width: media?.width } : undefined)

  // Новый снимок — снова с заглушки (листание просмотрщика, смена сторис).
  useEffect(() => setLoaded(false), [src, srcSet])

  // Из кеша картинка бывает готова раньше, чем навесится onLoad, — проверяем complete.
  const attach = useCallback(
    (el: HTMLImageElement | null) => {
      if (el?.complete && el.naturalWidth > 0) setLoaded(true)
      if (typeof imgRef === 'function') imgRef(el)
      else if (imgRef) (imgRef as { current: HTMLImageElement | null }).current = el
    },
    [imgRef],
  )

  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain'
  return (
    <span className={cn('relative block overflow-hidden', className)} style={style}>
      {media?.placeholder && !loaded && (
        <img
          src={media.placeholder}
          alt=""
          aria-hidden
          draggable={false}
          // Растянутые 16 пикселей без размытия — мозаика; blur и лёгкий scale прячут и её,
          // и светлую кайму, которую blur рисует по краям.
          className={cn('absolute inset-0 size-full scale-110 blur-lg', objectFit)}
        />
      )}
      {src && (
        <img
          ref={attach}
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? (sizes ?? '100vw') : undefined}
          alt={alt}
          loading={loading}
          decoding="async"
          draggable={draggable}
          onLoad={() => {
            setLoaded(true)
            onLoad?.()
          }}
          onError={onError}
          onClick={onClick}
          style={imgStyle}
          className={cn(
            'relative size-full transition-opacity duration-300 motion-reduce:transition-none',
            objectFit,
            loaded ? 'opacity-100' : 'opacity-0',
            imgClassName,
          )}
        />
      )}
    </span>
  )
}
