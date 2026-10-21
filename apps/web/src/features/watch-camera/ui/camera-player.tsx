'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Maximize2, Minimize2, TriangleAlert, VideoOff, X } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { attachLive, type LiveState } from '../lib/live-hls'
import { useCameraView } from '../model/use-camera-view'
import { Watermark } from './watermark'

export interface WatchedCamera {
  id: string
  name: string
  room: { name: string } | null
}

/**
 * Окно одной камеры: живое видео с ретранслятора, водяной знак, полный экран. Звука нет
 * (его не передаёт агент), скачать нечего — нативных контролов и меню у видео нет.
 */
export function CameraPlayer({
  camera,
  viewer,
  onClose,
}: {
  camera: WatchedCamera
  /** ФИО смотрящего — для водяного знака. */
  viewer: string
  onClose: () => void
}) {
  const t = useTranslations('CameraWatch')
  const tErr = useTranslations('Errors')
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { status, getToken } = useCameraView(camera.id)
  const [live, setLive] = useState<LiveState>('connecting')
  const [fullscreen, setFullscreen] = useState(false)
  const hlsUrl = status.kind === 'active' ? status.ticket.hlsUrl : null

  useEffect(() => {
    const video = videoRef.current
    if (!video || !hlsUrl) return
    let destroyed = false
    let handle: { destroy: () => void } | null = null
    void attachLive(video, hlsUrl, getToken, (state) => {
      if (!destroyed) setLive(state)
    }).then((h) => {
      if (destroyed) h.destroy()
      else handle = h
    })
    return () => {
      destroyed = true
      handle?.destroy()
    }
  }, [hlsUrl, getToken])

  // Полный экран могут закрыть и мимо кнопки (Esc, жест браузера) — состояние берём из
  // события документа, а не из своего нажатия.
  useEffect(() => {
    const sync = (): void => setFullscreen(document.fullscreenElement === frameRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void frameRef.current?.requestFullscreen?.().catch(() => undefined)
  }

  const message =
    status.kind === 'blocked'
      ? t(`blocked.${status.reason}`)
      : status.kind === 'error'
        ? tErr(status.code)
        : live === 'unsupported'
          ? t('unsupported')
          : live === 'failed'
            ? t('failed')
            : null
  const loading = !message && (status.kind === 'starting' || live === 'connecting')

  return (
    <div
      ref={frameRef}
      className="group relative flex aspect-video w-full overflow-hidden rounded-xl bg-black [&:fullscreen]:rounded-none"
    >
      <video
        ref={videoRef}
        className={cn('size-full object-contain', message && 'invisible')}
        muted
        autoPlay
        playsInline
        disablePictureInPicture
        controls={false}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={camera.name}
      />
      {!message && <Watermark viewer={viewer} />}

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
          <Loader2 className="size-6 animate-spin" aria-hidden />
          <p className="text-xs">{t('connecting')}</p>
        </div>
      )}
      {message && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/80">
          {status.kind === 'blocked' ? (
            <VideoOff className="size-6" aria-hidden />
          ) : (
            <TriangleAlert className="size-6" aria-hidden />
          )}
          <p className="text-xs">{message}</p>
        </div>
      )}

      {/* Подпись и управление — поверх кадра сверху, на градиенте. */}
      <div className="absolute inset-x-0 top-0 flex items-start gap-2 bg-gradient-to-b from-black/70 to-transparent p-2 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {live === 'playing' && !message && (
              <span
                className="mr-1.5 inline-block size-2 rounded-full bg-red-500 align-middle"
                aria-hidden
              />
            )}
            {camera.name}
          </p>
          {camera.room && <p className="truncate text-xs text-white/70">{camera.room.name}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
          title={fullscreen ? t('exitFullscreen') : t('fullscreen')}
          onClick={toggleFullscreen}
        >
          {fullscreen ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
        </Button>
        {/* На полном экране крестика нет: там его ждут как «выйти из полноэкранного», а он
            закрывал камеру — окно пропадало из стены вместе с выбором в списке. */}
        {!fullscreen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            className="text-white hover:bg-white/15 hover:text-white"
            aria-label={t('close')}
            title={t('close')}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
