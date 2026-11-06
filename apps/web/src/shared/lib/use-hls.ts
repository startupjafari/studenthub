'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { resolveApiPath } from '../api/media'

// Адаптивное воспроизведение HLS из медиа-системы (360–1080p по короткой стороне кадра).
//
// Порядок выбора движка:
// 1. hls.js поверх MediaSource — Chrome, Firefox, Edge, Android и iOS 17.1+ (ManagedMediaSource).
//    Он сам меряет скорость сети и переключает рендишн, а ручной выбор качества возможен
//    только здесь.
// 2. Нативный HLS — Safari на старых iOS без MediaSource: качество выбирает система.
// 3. Оригинал файла — HLS нет вовсе или он упал фатально: видео играет как до медиа-системы.
//
// hls.js грузится лениво (~150 КБ): страница без видео его не скачивает вовсе.

export interface HlsLevel {
  /** Индекс рендишна в hls.js — значение для `setLevel`. */
  index: number
  /** Ступень по короткой стороне кадра: «720» у вертикального 720×1280 тоже. */
  short: number
}

export interface HlsQuality {
  /** Рендишны по убыванию качества; пусто — выбирать нечего (нативный HLS или оригинал). */
  levels: HlsLevel[]
  /** Выбранный вручную индекс; -1 — автоматически. */
  level: number
  /** Что играет сейчас в автоматическом режиме — для подписи «Авто (720p)». */
  playingShort: number | null
  setLevel: (index: number) => void
}

function hasMediaSource(): boolean {
  return (
    typeof window !== 'undefined' && ('MediaSource' in window || 'ManagedMediaSource' in window)
  )
}

export function useHls(
  video: HTMLVideoElement | null,
  hlsPath: string | null | undefined,
  fallbackSrc: string | undefined,
): HlsQuality {
  const hlsRef = useRef<Hls | null>(null)
  const [levels, setLevels] = useState<HlsLevel[]>([])
  const [level, setLevelState] = useState(-1)
  const [playingShort, setPlayingShort] = useState<number | null>(null)

  useEffect(() => {
    if (!video || !hlsPath) return
    const url = resolveApiPath(hlsPath)
    let cancelled = false
    const playOriginal = (): void => {
      if (fallbackSrc && video.getAttribute('src') !== fallbackSrc) video.src = fallbackSrc
    }

    if (!hasMediaSource()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url
      else playOriginal()
      return () => {
        video.removeAttribute('src')
      }
    }

    void import('hls.js').then(({ default: HlsCtor }) => {
      if (cancelled) return
      if (!HlsCtor.isSupported()) {
        playOriginal()
        return
      }
      const hls = new HlsCtor({
        // Не тянуть 1080p в окошко 360 пикселей: потолок — размер самого плеера.
        capLevelToPlayerSize: true,
        // Буфер вперёд скромный: на мобильном трафике видео часто бросают на середине.
        maxBufferLength: 20,
        backBufferLength: 30,
      })
      hlsRef.current = hls
      let recovered = false
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        setLevels(
          hls.levels
            .map((l, index) => ({ index, short: Math.min(l.width, l.height) }))
            .sort((a, b) => b.short - a.short),
        )
      })
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => {
        const l = hls.levels[data.level]
        setPlayingShort(l ? Math.min(l.width, l.height) : null)
      })
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        // Одна попытка восстановиться на месте; не вышло — оригинал, а не чёрный кадр.
        if (!recovered && data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          recovered = true
          hls.recoverMediaError()
          return
        }
        if (!recovered && data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
          recovered = true
          hls.startLoad()
          return
        }
        hls.destroy()
        hlsRef.current = null
        setLevels([])
        playOriginal()
      })
      hls.loadSource(url)
      hls.attachMedia(video)
    })

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
      setLevels([])
      setLevelState(-1)
      setPlayingShort(null)
    }
  }, [video, hlsPath, fallbackSrc])

  const setLevel = useCallback((index: number): void => {
    const hls = hlsRef.current
    if (!hls) return
    // currentLevel, а не nextLevel: выбранное вручную качество человек хочет видеть сразу.
    hls.currentLevel = index
    setLevelState(index)
  }, [])

  return { levels, level, playingShort, setLevel }
}
