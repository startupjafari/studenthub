'use client'

import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ImagePlus, X } from 'lucide-react'
import type { StoryBackgroundValue } from '@studenthub/shared-schemas'
import {
  STORY_BACKGROUND_CLASS,
  StoryElementBody,
  storyElementPlacement,
} from '../../../entities/story'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { clamp01, type EditorElement } from '../model/editor-element'

// Подпись элемента для читалки — по типу (статические ключи, FRONTEND_RULES §10).
const TYPE_KEY = {
  text: 'toolText',
  emoji: 'toolEmoji',
  mention: 'toolMention',
  event: 'toolEvent',
  post: 'toolPost',
  schedule: 'toolPair',
} as const

// Шаг сдвига стрелками — доля кадра; с Shift — крупнее.
const KEY_STEP = 0.01
const KEY_STEP_BIG = 0.05

export interface CanvasMedia {
  /** Локальный object-URL для превью: подписанную ссылку сервер отдаст уже в ленте. */
  url: string
  isVideo: boolean
}

/**
 * Холст редактора: кадр 9:16 с фоном или медиа и элементами поверх. Элемент выбирают
 * нажатием, двигают мышью или пальцем, а с клавиатуры — стрелками (Delete удаляет).
 * На пустой холст можно бросить файл — тот же путь, что у кнопки «Медиа».
 */
export function StoryCanvas({
  media,
  background,
  elements,
  selectedId,
  uploading,
  onSelect,
  onMove,
  onRemove,
  onRemoveMedia,
  onDropFile,
}: {
  media: CanvasMedia | null
  background: StoryBackgroundValue | undefined
  elements: EditorElement[]
  selectedId: string | null
  uploading: boolean
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onRemove: (id: string) => void
  onRemoveMedia: () => void
  onDropFile: (file: File) => void
}) {
  const t = useTranslations('Stories')
  const canvasRef = useRef<HTMLDivElement>(null)
  // Смещение точки захвата от центра элемента: элемент не «прыгает» центром под палец.
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  function pointerToCanvas(e: PointerEvent): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0.5, y: 0.5 }
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  function startDrag(e: PointerEvent<HTMLButtonElement>, element: EditorElement): void {
    e.stopPropagation()
    onSelect(element.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerToCanvas(e)
    drag.current = { id: element.id, dx: p.x - element.x, dy: p.y - element.y }
  }

  function moveDrag(e: PointerEvent): void {
    const d = drag.current
    if (!d) return
    const p = pointerToCanvas(e)
    onMove(d.id, clamp01(p.x - d.dx), clamp01(p.y - d.dy))
  }

  function onElementKey(e: KeyboardEvent, element: EditorElement): void {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      onMove(element.id, clamp01(element.x + move[0]), clamp01(element.y + move[1]))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemove(element.id)
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onDropFile(file)
  }

  return (
    <div
      ref={canvasRef}
      role="group"
      aria-label={t('editorCanvas')}
      className={cn(
        'relative aspect-[9/16] w-full max-w-[18rem] shrink-0 touch-none overflow-hidden rounded-2xl text-white @container select-none',
        media ? 'bg-black' : STORY_BACKGROUND_CLASS[background ?? 'graphite'],
        dragOver && 'ring-4 ring-primary/60',
      )}
      onPointerDown={() => onSelect(null)}
      onPointerMove={moveDrag}
      onPointerUp={() => {
        drag.current = null
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {media &&
        (media.isVideo ? (
          <video
            src={media.url}
            className="size-full object-cover"
            muted
            playsInline
            autoPlay
            loop
          />
        ) : (
          // Локальный object-URL: оптимизировать blob next/image не может.
          <img src={media.url} alt="" className="size-full object-cover" />
        ))}

      {!media && elements.length === 0 && (
        <p className="pointer-events-none absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-center text-sm text-white/80">
          <ImagePlus className="size-6" aria-hidden />
          {uploading ? t('uploading') : t('dropHint')}
        </p>
      )}

      {elements.map((element) => (
        <button
          key={element.id}
          type="button"
          aria-label={t('elementLabel', { type: t(TYPE_KEY[element.type]) })}
          aria-pressed={selectedId === element.id}
          className={cn(
            'absolute cursor-grab rounded-md outline-none active:cursor-grabbing',
            selectedId === element.id
              ? 'ring-2 ring-white ring-offset-2 ring-offset-black/40'
              : 'focus-visible:ring-2 focus-visible:ring-white/70',
          )}
          style={storyElementPlacement(element)}
          onPointerDown={(e) => startDrag(e, element)}
          onKeyDown={(e) => onElementKey(e, element)}
          onFocus={() => onSelect(element.id)}
        >
          <StoryElementBody element={element} mentionName={element.name} />
        </button>
      ))}

      {media && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={t('removeMedia')}
          className="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemoveMedia}
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
