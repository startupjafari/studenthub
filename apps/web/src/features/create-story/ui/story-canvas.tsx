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
import { placedTransform } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { clamp01, type EditorElement } from '../model/editor-element'
import { STORY_BLUR_PX, STORY_WIDTH, type StoryStage } from '../model/use-story-stage'

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

/**
 * Сцена редактора: кадр 9:16 по центру, вокруг — то, что останется за кадром, притемнённое.
 * Фото лежит под кадром и двигается жестами сцены (сдвиг, щипок, колесо); элементы — поверх
 * фото, их двигают мышью или пальцем, с клавиатуры — стрелками (Delete удаляет). На сцену
 * можно бросить файл — тот же путь, что у кнопки «Фото или видео».
 */
export function StoryCanvas({
  stage,
  hasPhoto,
  videoUrl,
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
  stage: StoryStage
  hasPhoto: boolean
  /** Локальный object-URL видео для превью: подписанную ссылку сервер отдаст уже в ленте. */
  videoUrl: string | null
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
  const frameRef = useRef<HTMLDivElement>(null)
  // Смещение точки захвата от центра элемента: элемент не «прыгает» центром под палец.
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const { stage: size, frame, nat, url } = stage
  const hasMedia = hasPhoto || videoUrl !== null
  const frameBox =
    size && frame
      ? {
          left: (size.w - frame.w) / 2,
          top: (size.h - frame.h) / 2,
          width: frame.w,
          height: frame.h,
        }
      : undefined

  function pointerToFrame(e: PointerEvent): { x: number; y: number } {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0.5, y: 0.5 }
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  function startDrag(e: PointerEvent<HTMLButtonElement>, element: EditorElement): void {
    // Элемент двигается сам — сцена под ним не должна начать сдвиг фото.
    e.stopPropagation()
    onSelect(element.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerToFrame(e)
    drag.current = { id: element.id, dx: p.x - element.x, dy: p.y - element.y }
  }

  function moveDrag(e: PointerEvent): void {
    const d = drag.current
    if (!d) return
    const p = pointerToFrame(e)
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
      ref={stage.stageRef}
      className={cn(
        'relative min-h-0 flex-1 touch-none overflow-hidden select-none',
        hasPhoto && (stage.interacting ? 'cursor-grabbing' : 'cursor-grab'),
      )}
      onPointerDown={(e) => {
        onSelect(null)
        if (hasPhoto) stage.handlers.onPointerDown(e)
      }}
      onPointerMove={stage.handlers.onPointerMove}
      onPointerUp={stage.handlers.onPointerUp}
      onPointerCancel={stage.handlers.onPointerCancel}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* Подложка кадра: фон текстовой сторис или чёрный под медиа; у фото «целиком» —
          оно же, размытое, как в итоговом снимке. Пока сцена не измерена, кадр — вся сцена:
          в браузере это не дольше кадра, а без ResizeObserver (тесты) иначе не было бы
          слоя элементов вовсе. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute overflow-hidden rounded-2xl',
          !frameBox && 'inset-0',
          hasMedia ? 'bg-black' : STORY_BACKGROUND_CLASS[background ?? 'graphite'],
        )}
        style={frameBox}
      >
        {hasPhoto && url && stage.whole && frame && (
          // Локальный object-URL: оптимизировать blob next/image не может.
          <img
            src={url}
            alt=""
            className="size-full object-cover"
            style={{
              filter: `blur(${(STORY_BLUR_PX * frame.w) / STORY_WIDTH}px) brightness(0.65)`,
            }}
          />
        )}
      </div>

      {/* Фото во всю сцену: за кадром видно, что ещё есть на снимке. */}
      {hasPhoto && url && (
        <img
          ref={stage.imgRef}
          src={url}
          alt=""
          onLoad={stage.onImageLoad}
          draggable={false}
          className={cn(
            'pointer-events-none absolute top-0 left-0 max-w-none origin-center',
            stage.animate && 'transition-transform duration-200 ease-out',
            !stage.ready && 'opacity-0',
          )}
          style={
            nat && size
              ? {
                  width: nat.w,
                  height: nat.h,
                  transform: placedTransform(size, nat, stage.place, stage.deg, stage.flip),
                }
              : undefined
          }
        />
      )}

      {frameBox && hasPhoto && (
        // Всё за кадром притемнено тенью окна-выреза; сетка третей — пока фото двигают.
        <div aria-hidden className="pointer-events-none absolute rounded-2xl" style={frameBox}>
          <div
            className="absolute inset-0 rounded-2xl"
            style={{ boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }}
          />
          <div
            className={cn(
              'absolute inset-0 transition-opacity duration-200',
              stage.interacting ? 'opacity-100' : 'opacity-0',
            )}
          >
            <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
            <span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
            <span className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
            <span className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
          </div>
        </div>
      )}

      <div
        ref={frameRef}
        role="group"
        aria-label={t('editorCanvas')}
        className={cn(
          'pointer-events-none absolute overflow-hidden rounded-2xl text-white @container',
          !frameBox && 'inset-0',
          dragOver && 'ring-4 ring-primary/60',
        )}
        style={frameBox}
        onPointerMove={moveDrag}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        {videoUrl && (
          <video
            src={videoUrl}
            className="size-full object-cover"
            muted
            playsInline
            autoPlay
            loop
          />
        )}

        {!hasMedia && elements.length === 0 && (
          <p className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-center text-sm text-white/80">
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
              'pointer-events-auto absolute cursor-grab rounded-md outline-none active:cursor-grabbing',
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

        {hasMedia && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            aria-label={t('removeMedia')}
            className="pointer-events-auto absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemoveMedia}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
