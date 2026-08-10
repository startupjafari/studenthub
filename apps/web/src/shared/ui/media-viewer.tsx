'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Download, Loader2, RotateCw, X } from 'lucide-react'
import { useBodyScrollLock } from '../lib'

export interface MediaViewerItem {
  mime: string
  name?: string | null
}

// Единый полноэкранный просмотрщик фото/видео (стиль чата): тёмный оверлей, медиа по центру,
// навигация ◀▶, поворот, скачивание, счётчик N/M. Закрытие по фону/Esc/крестику.
// Универсальный: URL текущего элемента резолвит вызывающий (src), слоты topLeft/caption/trailing
// позволяют доклеить контекст (отправитель, подпись, меню действий) — используется и в чате, и в профиле.
export function MediaViewer({
  items,
  index,
  src,
  onIndexChange,
  onClose,
  topLeft,
  caption,
  trailing,
  downloadUrl,
  downloadName,
  onContextMenuCapture,
}: {
  items: MediaViewerItem[]
  index: number
  /** Готовый URL текущего элемента; undefined — показываем спиннер (ленивая загрузка). */
  src?: string
  onIndexChange: (i: number) => void
  onClose: () => void
  topLeft?: ReactNode
  caption?: ReactNode
  trailing?: ReactNode
  downloadUrl?: string
  downloadName?: string | null
  onContextMenuCapture?: (e: React.MouseEvent) => void
}) {
  const t = useTranslations('Common')
  useBodyScrollLock()
  const [rotation, setRotation] = useState(0)
  const cur = items[index]

  useEffect(() => setRotation(0), [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndexChange])

  if (!cur || typeof document === 'undefined') return null
  const isVideo = cur.mime.startsWith('video/')
  const transform = { transform: `rotate(${rotation}deg)` }
  const dl = downloadUrl ?? src

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex select-none flex-col bg-black/80"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenuCapture?.(e)
      }}
    >
      {/* Верхняя панель: скачать + закрыть */}
      <div className="flex items-center justify-end gap-1 p-3" onClick={(e) => e.stopPropagation()}>
        {dl && (
          <a
            href={dl}
            download={downloadName ?? cur.name ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('download')}
            className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Download className="size-5" aria-hidden />
          </a>
        )}
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/* Медиа — заполняет доступную область (крупное отображение) */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2 py-1 sm:px-4 sm:py-2"
        onClick={onClose}
      >
        {items.length > 1 && index > 0 && (
          <button
            type="button"
            aria-label={t('previous')}
            onClick={(e) => {
              e.stopPropagation()
              onIndexChange(index - 1)
            }}
            className="absolute left-2 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </button>
        )}

        {!src ? (
          <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
        ) : isVideo ? (
          <video
            src={src}
            controls
            autoPlay
            style={transform}
            className="h-full max-h-full w-auto max-w-full rounded-lg object-contain transition-transform"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={src}
            alt={cur.name ?? ''}
            draggable={false}
            style={transform}
            className="h-full max-h-full w-auto max-w-full object-contain transition-transform"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {items.length > 1 && index < items.length - 1 && (
          <button
            type="button"
            aria-label={t('next')}
            onClick={(e) => {
              e.stopPropagation()
              onIndexChange(index + 1)
            }}
            className="absolute right-2 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronRight className="size-6" aria-hidden />
          </button>
        )}
      </div>

      {/* Нижняя панель: слева — контекст; по центру — подпись; справа — счётчик + поворот + доп.действия */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-1" onClick={(e) => e.stopPropagation()}>
        {topLeft ?? <span />}

        <div className="flex min-w-0 flex-1 justify-center">{caption}</div>

        <div className="flex shrink-0 items-center gap-2">
          {items.length > 1 && (
            <span className="text-xs text-white/60 tabular-nums">
              {index + 1} / {items.length}
            </span>
          )}

          <button
            type="button"
            aria-label={t('rotate')}
            onClick={() => setRotation((r) => r + 90)}
            className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RotateCw className="size-5" aria-hidden />
          </button>

          {trailing}
        </div>
      </div>
    </div>,
    document.body,
  )
}
