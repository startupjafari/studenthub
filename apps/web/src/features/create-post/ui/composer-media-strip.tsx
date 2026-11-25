'use client'

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle, Play, RotateCw, X } from 'lucide-react'
import { ProgressRing } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import type { ComposerMedia } from '../model/media-queue'

/** Тип перетаскивания внутри ленты — чтобы не путать перестановку с файлами снаружи. */
export const MEDIA_REORDER_TYPE = 'application/x-studenthub-media'

/**
 * Вложения редактора — лентой превью под текстом. Порядок в ленте — ровно тот, в каком
 * снимки увидят читатели: его меняют перетаскиванием (мышь) или Alt+←/→ на выбранном
 * превью (клавиатура). У каждого файла — свой прогресс, отмена и повтор при ошибке.
 */
export function ComposerMediaStrip({
  items,
  onRemove,
  onRetry,
  onMove,
}: {
  items: ComposerMedia[]
  onRemove: (key: string) => void
  onRetry: (key: string) => void
  onMove: (from: number, to: number) => void
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // После перестановки с клавиатуры фокус остаётся на том же превью, уже на новом месте.
  const focusKey = useRef<string | null>(null)
  const nodes = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!focusKey.current) return
    nodes.current.get(focusKey.current)?.focus()
    focusKey.current = null
  }, [items])

  function onKey(e: KeyboardEvent<HTMLDivElement>, index: number, key: string): void {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onRemove(key)
      }
      return
    }
    e.preventDefault()
    const to = e.key === 'ArrowLeft' ? index - 1 : index + 1
    if (to < 0 || to >= items.length) return
    focusKey.current = key
    onMove(index, to)
  }

  function dropAt(e: DragEvent<HTMLDivElement>, index: number): void {
    if (!e.dataTransfer.types.includes(MEDIA_REORDER_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    if (dragFrom !== null && dragFrom !== index) onMove(dragFrom, index)
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <ul
      aria-label={t('attachments')}
      className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
    >
      {items.map((m, i) => {
        const label = t('mediaPosition', { current: i + 1, total: items.length })
        return (
          <li key={m.key} className="shrink-0">
            <div
              ref={(node) => {
                if (node) nodes.current.set(m.key, node)
                else nodes.current.delete(m.key)
              }}
              tabIndex={0}
              role="group"
              aria-label={`${label}. ${t('mediaReorderHint')}`}
              draggable={items.length > 1}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(MEDIA_REORDER_TYPE, m.key)
                setDragFrom(i)
              }}
              onDragEnter={(e) => {
                if (e.dataTransfer.types.includes(MEDIA_REORDER_TYPE)) setDragOver(i)
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(MEDIA_REORDER_TYPE)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => dropAt(e, i)}
              onDragEnd={() => {
                setDragFrom(null)
                setDragOver(null)
              }}
              onKeyDown={(e) => onKey(e, i, m.key)}
              className={cn(
                'group relative size-24 overflow-hidden rounded-xl bg-muted outline-none sm:size-28',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                items.length > 1 && 'cursor-grab active:cursor-grabbing',
                dragFrom === i && 'opacity-40',
                dragOver === i && dragFrom !== i && 'ring-2 ring-primary',
              )}
            >
              {m.isVideo ? (
                <video src={m.previewUrl} muted playsInline className="size-full object-cover" />
              ) : (
                <img
                  src={m.previewUrl}
                  alt=""
                  draggable={false}
                  className="size-full object-cover"
                />
              )}

              {m.isVideo && m.status === 'done' && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white">
                    <Play className="ml-0.5 size-4 fill-current" aria-hidden />
                  </span>
                </span>
              )}

              {/* Позиция — видна, только когда есть что упорядочивать. */}
              {items.length > 1 && m.status === 'done' && (
                <span className="pointer-events-none absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-[11px] font-medium text-white tabular-nums">
                  {i + 1}
                </span>
              )}

              {m.status === 'uploading' && (
                <span
                  role="progressbar"
                  aria-label={t('uploadingMedia')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={m.progress}
                  className="absolute inset-0 flex items-center justify-center bg-black/45 text-white"
                >
                  <ProgressRing
                    progress={m.progress > 0 ? m.progress / 100 : null}
                    className="size-10"
                  />
                </span>
              )}

              {m.status === 'error' && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 px-2 text-center text-white">
                  <AlertCircle className="size-4 text-destructive" aria-hidden />
                  <span className="line-clamp-2 text-[11px] leading-tight">
                    {tErr(m.errorCode ?? 'INTERNAL_ERROR')}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRetry(m.key)}
                    className="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-white/15 px-2.5 text-[11px] font-medium transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                  >
                    <RotateCw className="size-3" aria-hidden />
                    {t('retryUpload')}
                  </button>
                </span>
              )}

              <button
                type="button"
                aria-label={m.status === 'uploading' ? t('cancelUpload') : t('removeMedia')}
                title={m.status === 'uploading' ? t('cancelUpload') : t('removeMedia')}
                onClick={() => onRemove(m.key)}
                // На тач-экране крестик виден всегда: наводить там нечем.
                className={cn(
                  'absolute top-1 right-1 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-opacity duration-150 hover:bg-black/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none',
                  m.status === 'done' &&
                    '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100',
                )}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
