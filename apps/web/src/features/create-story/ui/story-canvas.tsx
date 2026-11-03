'use client'

import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { useTranslations } from 'next-intl'
import { ImagePlus, RotateCw, Type, X } from 'lucide-react'
import { STORY_ELEMENT_TEXT_MAX, type StoryBackgroundValue } from '@studenthub/shared-schemas'
import {
  STORY_BACKGROUND_CLASS,
  StoryElementBody,
  storyElementPlacement,
} from '../../../entities/story'
import { Button } from '../../../shared/ui'
import { placedTransform } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { clamp01, type EditorElement } from '../model/editor-element'
import {
  STORY_BLUR_PX,
  STORY_PHOTO_FILTERS,
  STORY_WIDTH,
  type StoryStage,
} from '../model/use-story-stage'

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
// Прилипание к центру кадра при перетаскивании — доля кадра.
const SNAP = 0.015
// Прилипание поворота к прямым углам, градусы.
const SNAP_DEG = 4
// Пределы размера элемента — как в схеме (StoryElementSchema.scale).
const MIN_SCALE = 0.4
const MAX_SCALE = 3
// Углы рамки выбранного элемента: тянут — меняется размер. Центр маркера (20px) — ровно
// на углу контура, который отстоит от элемента на 4px: 4 + 20/2 = 14px.
const CORNERS = [
  '-left-3.5 -top-3.5',
  '-right-3.5 -top-3.5',
  '-left-3.5 -bottom-3.5',
  '-right-3.5 -bottom-3.5',
]

type Drag =
  | { mode: 'move'; id: string; dx: number; dy: number }
  | { mode: 'scale'; id: string; cx: number; cy: number; d0: number; s0: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number; a0: number; r0: number }

/** Угол в пределах −180…180, у прямых углов — прилипает. */
function normalizeDeg(deg: number): number {
  let d = ((((deg + 180) % 360) + 360) % 360) - 180
  for (const right of [-180, -90, 0, 90, 180]) {
    if (Math.abs(d - right) < SNAP_DEG) d = right === -180 ? 180 : right
  }
  return Math.round(d)
}

/**
 * Сцена редактора: кадр 9:16 по центру рабочей области, вокруг — то, что останется за
 * кадром, притемнённое. Фото лежит под кадром и двигается жестами сцены (сдвиг, щипок,
 * колесо); элементы — поверх фото. Выбранный элемент обведён рамкой: за углы меняют
 * размер, за маркер сверху — поворот. При перетаскивании видны безопасные зоны (сверху
 * в просмотре — полоса прогресса и автор, снизу — поле ответа) и центр кадра, к которому
 * элемент прилипает. Текст правят прямо на кадре (двойной клик или сразу после добавления).
 * С клавиатуры элемент двигают стрелками; удаление, отмена и Esc — у редактора.
 *
 * Пустой кадр — крупная зона загрузки: файл можно выбрать или бросить прямо в кадр, а
 * вместо медиа начать текстовую сторис.
 */
export function StoryCanvas({
  stage,
  hasPhoto,
  videoUrl,
  videoRef,
  background,
  elements,
  selectedId,
  editingId,
  onSelect,
  onPatch,
  onStartEdit,
  onEditDone,
  onRemoveMedia,
  onTapStage,
  onPickMedia,
  onTextStory,
  onDropFile,
}: {
  stage: StoryStage
  hasPhoto: boolean
  /** Локальный object-URL видео для превью: подписанную ссылку сервер отдаст уже в ленте. */
  videoUrl: string | null
  /** Превью видео: звуком, паузой и отрезком управляет редактор. */
  videoRef: RefObject<HTMLVideoElement | null>
  background: StoryBackgroundValue | undefined
  elements: EditorElement[]
  selectedId: string | null
  /** Текст, который сейчас правят на кадре. */
  editingId: string | null
  onSelect: (id: string | null) => void
  /** `key` склеивает серию правок в один шаг истории (перетаскивание, набор текста). */
  onPatch: (id: string, patch: Partial<EditorElement>, key?: string) => void
  onStartEdit: (id: string) => void
  onEditDone: (id: string) => void
  onRemoveMedia: () => void
  /** Нажали на сцену мимо элементов — на фото или на пустое место. */
  onTapStage: () => void
  onPickMedia: () => void
  onTextStory: () => void
  onDropFile: (file: File) => void
}) {
  const t = useTranslations('Stories')
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<{ x: boolean; y: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const { stage: size, frame, nat, url } = stage
  const hasMedia = hasPhoto || videoUrl !== null
  const empty = !hasMedia && elements.length === 0
  const tone = STORY_PHOTO_FILTERS[stage.filter]
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

  function startMove(e: PointerEvent<HTMLButtonElement>, element: EditorElement): void {
    // Элемент двигается сам — сцена под ним не должна начать сдвиг фото.
    e.stopPropagation()
    onSelect(element.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerToFrame(e)
    // Направляющие — с первого сдвига, а не на простом нажатии.
    drag.current = { mode: 'move', id: element.id, dx: p.x - element.x, dy: p.y - element.y }
  }

  /** Маркер рамки: размер (углы) или поворот (сверху) — относительно центра элемента. */
  function startTransform(
    e: PointerEvent<HTMLSpanElement>,
    element: EditorElement,
    mode: 'scale' | 'rotate',
  ): void {
    e.stopPropagation()
    const box = e.currentTarget.closest('button')?.getBoundingClientRect()
    if (!box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const vx = e.clientX - cx
    const vy = e.clientY - cy
    drag.current =
      mode === 'scale'
        ? { mode, id: element.id, cx, cy, d0: Math.hypot(vx, vy) || 1, s0: element.scale }
        : { mode, id: element.id, cx, cy, a0: Math.atan2(vy, vx), r0: element.rotation }
  }

  function onDragMove(e: PointerEvent): void {
    const d = drag.current
    if (!d) return
    if (d.mode === 'move') {
      const p = pointerToFrame(e)
      let x = clamp01(p.x - d.dx)
      let y = clamp01(p.y - d.dy)
      const snapX = Math.abs(x - 0.5) < SNAP
      const snapY = Math.abs(y - 0.5) < SNAP
      if (snapX) x = 0.5
      if (snapY) y = 0.5
      setGuides((g) => (g && g.x === snapX && g.y === snapY ? g : { x: snapX, y: snapY }))
      onPatch(d.id, { x, y }, `move:${d.id}`)
    } else if (d.mode === 'scale') {
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy)
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (d.s0 * dist) / d.d0))
      onPatch(d.id, { scale: Math.round(scale * 100) / 100 }, `scale:${d.id}`)
    } else {
      const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx)
      onPatch(
        d.id,
        { rotation: normalizeDeg(d.r0 + ((a - d.a0) * 180) / Math.PI) },
        `rotate:${d.id}`,
      )
    }
  }

  function endDrag(): void {
    drag.current = null
    setGuides(null)
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
      onPatch(
        element.id,
        { x: clamp01(element.x + move[0]), y: clamp01(element.y + move[1]) },
        `move:${element.id}`,
      )
    } else if (e.key === 'Enter' && element.type === 'text') {
      e.preventDefault()
      onStartEdit(element.id)
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
        onTapStage()
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
          // Кадр отделён от фона тонким контуром и мягкой тенью — без тяжёлых рамок.
          'pointer-events-none absolute overflow-hidden rounded-2xl shadow-[0_12px_40px_rgb(0_0_0/0.35)] ring-1 ring-white/10',
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
              filter: `blur(${(STORY_BLUR_PX * frame.w) / STORY_WIDTH}px) brightness(0.65) ${tone}`,
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
                  filter: tone || undefined,
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
          'pointer-events-none absolute rounded-2xl text-white @container',
          !frameBox && 'inset-0',
          dragOver && 'ring-4 ring-primary/60',
        )}
        style={frameBox}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Видео и подсказки обрезаются по кадру; элементы — нет: у выбранного маркеры
            рамки выходят за край, и обрезанный маркер не за что было бы взять. */}
        <div className="absolute inset-0 overflow-hidden rounded-2xl">
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              className="size-full object-cover"
              muted
              playsInline
              autoPlay
            />
          )}

          {guides && (
            // Безопасные зоны и центр кадра — пока элемент тащат.
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-white/50 bg-black/20" />
              <div className="absolute inset-x-0 bottom-0 h-[15%] border-t border-dashed border-white/50 bg-black/20" />
              {guides.x && <div className="absolute inset-y-0 left-1/2 w-px bg-primary" />}
              {guides.y && <div className="absolute inset-x-0 top-1/2 h-px bg-primary" />}
            </div>
          )}
        </div>

        {empty && (
          <div
            className="pointer-events-auto absolute inset-3 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/25 p-4 text-center"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-white/10">
              <ImagePlus className="size-7" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{t('emptyTitle')}</p>
              <p className="text-xs text-white/70">{t('emptyHint')}</p>
            </div>
            <Button type="button" size="md" onClick={onPickMedia}>
              <ImagePlus className="size-4" aria-hidden />
              {t('media')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={onTextStory}
            >
              <Type className="size-4" aria-hidden />
              {t('textStory')}
            </Button>
          </div>
        )}

        {elements.map((element) => {
          const selected = selectedId === element.id
          if (editingId === element.id && element.type === 'text') {
            return (
              <div
                key={element.id}
                className="pointer-events-auto absolute rounded-md outline-2 outline-offset-4 outline-white/70 outline-dashed"
                style={storyElementPlacement(element)}
              >
                <StoryElementBody
                  element={element}
                  editing={{
                    label: t('editOnCanvas'),
                    maxLength: STORY_ELEMENT_TEXT_MAX,
                    onInput: (text) => onPatch(element.id, { text }, `text:${element.id}`),
                    onDone: () => onEditDone(element.id),
                  }}
                />
              </div>
            )
          }
          return (
            <button
              key={element.id}
              type="button"
              aria-label={t('elementLabel', { type: t(TYPE_KEY[element.type]) })}
              aria-pressed={selected}
              className={cn(
                'pointer-events-auto absolute cursor-grab rounded-md active:cursor-grabbing',
                selected
                  ? 'outline-2 outline-offset-4 outline-white outline-dashed animate-in fade-in-0 duration-150 motion-reduce:animate-none'
                  : 'outline-none focus-visible:ring-2 focus-visible:ring-white/70',
              )}
              style={storyElementPlacement(element)}
              onPointerDown={(e) => startMove(e, element)}
              onDoubleClick={() => element.type === 'text' && onStartEdit(element.id)}
              onKeyDown={(e) => onElementKey(e, element)}
              onFocus={() => onSelect(element.id)}
            >
              <StoryElementBody element={element} mentionName={element.name} />
              {selected && (
                <>
                  {CORNERS.map((pos) => (
                    <span
                      key={pos}
                      aria-hidden
                      onPointerDown={(e) => startTransform(e, element, 'scale')}
                      className={cn(
                        'absolute flex size-5 touch-none items-center justify-center',
                        pos.includes('left') === pos.includes('top')
                          ? 'cursor-nwse-resize'
                          : 'cursor-nesw-resize',
                        pos,
                      )}
                    >
                      <span className="size-2.5 rounded-full border border-black/30 bg-white shadow" />
                    </span>
                  ))}
                  <span
                    aria-hidden
                    onPointerDown={(e) => startTransform(e, element, 'rotate')}
                    className="absolute -top-9 left-1/2 flex size-6 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-full bg-white text-black shadow"
                  >
                    <RotateCw className="size-3.5" />
                  </span>
                </>
              )}
            </button>
          )
        })}

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
