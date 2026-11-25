'use client'

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import type { PostMedia } from '../../../entities/post'
import { cn } from '../../../shared/lib/utils'
import { MediaFrame } from './media-frame'
import { PostMediaView } from './post-media'

/**
 * Потолок высоты медиа в ленте: на десктопе 30rem (480px), на низком экране — две трети его
 * высоты. Раньше пост с вертикальными снимками в сетке 2×2 занимал больше экрана, и лента
 * превращалась в прокрутку одной публикации.
 */
const MEDIA_MAX_H = 'max-h-[min(30rem,65dvh)]'

/** Пропорции вложения (ширина / высота); без размеров с сервера — 4:3. */
function ratioOf(m: PostMedia): number {
  return m.width && m.height ? m.width / m.height : 4 / 3
}

/** Вертикальное: портрет, скан страницы, инфографика. В сетке их обрезало бы. */
function isPortrait(m: PostMedia): boolean {
  return ratioOf(m) < 0.9
}

/**
 * Графика, а не фотография: схемы, графики, скриншоты, слайды приходят в PNG (фото — в
 * JPEG/WebP/HEIC). Текст на них обрезать нельзя — только вписывать целиком.
 */
function isGraphic(m: PostMedia): boolean {
  return m.mime === 'image/png' || m.mime === 'image/svg+xml'
}

type Layout = 'single' | 'grid' | 'carousel'

/**
 * Раскладка набора. Горизонтальные фотографии (до четырёх) — компактной сеткой, в ней их
 * можно кадрировать. Вертикальные, графика и длинные серии — каруселью по одному кадру целиком:
 * у слайдов, сканов и инфографики обрезка съедала смысл, а сетка из вертикальных растягивала
 * карточку на два экрана.
 */
function layoutOf(media: readonly PostMedia[]): Layout {
  if (media.length === 1) return 'single'
  if (media.length <= 4 && !media.some((m) => isPortrait(m) || isGraphic(m))) return 'grid'
  return 'carousel'
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Медиа поста в ленте. Нажатие на кадр открывает полноэкранный просмотр с этого кадра;
 * `tileRef` регистрирует плитку, из которой он «вырастает» и в которую садится обратно.
 *
 * Место под медиа резервируется пропорцией ещё до загрузки (размеры приходят с сервера) —
 * лента не прыгает, когда снимки догружаются.
 */
export function PostGallery({
  postId,
  media,
  onOpen,
  tileRef,
}: {
  postId: string
  media: readonly PostMedia[]
  onOpen: (index: number) => void
  /** Регистрация плитки кадра — точка, откуда растёт полноэкранный просмотр. */
  tileRef: (index: number, el: HTMLElement | null) => void
}) {
  const t = useTranslations('Feed')
  const layout = layoutOf(media)
  const count = media.length

  if (layout === 'single') {
    const m = media[0]
    if (!m) return null
    return (
      <button
        type="button"
        ref={(el) => tileRef(0, el)}
        onClick={() => onOpen(0)}
        aria-label={t('openMedia')}
        // Своя пропорция кадра (вертикальное — не уже 4:5, панорама — не ниже 2.5:1), высота
        // под потолком: вертикальный снимок встаёт целиком, поля закрывает его размытая копия.
        style={{ aspectRatio: clamp(ratioOf(m), 0.8, 2.5) }}
        className={cn(
          'group/tile relative block w-full overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
          MEDIA_MAX_H,
        )}
      >
        <MediaFrame postId={postId} media={m} className="size-full" imageClassName="size-full" />
        {isVideo(m) && <PlayBadge />}
      </button>
    )
  }

  if (layout === 'grid') {
    const grid =
      count === 2
        ? 'aspect-[2/1] grid-cols-2'
        : count === 3
          ? 'aspect-[16/10] grid-cols-[2fr_1fr] grid-rows-2'
          : 'aspect-[16/10] grid-cols-2 grid-rows-2'
    return (
      <div className={cn('grid w-full gap-0.5', grid, MEDIA_MAX_H)}>
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            ref={(el) => tileRef(i, el)}
            onClick={() => onOpen(i)}
            aria-label={`${t('openMedia')} · ${i + 1}/${count}`}
            className={cn(
              'group/tile relative block min-h-0 overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
              count === 3 && i === 0 && 'row-span-2',
            )}
          >
            <PostMediaView
              postId={postId}
              media={m}
              fit="cover"
              sizes={
                count === 3 && i === 0
                  ? '(max-width: 768px) 66vw, 470px'
                  : '(max-width: 768px) 50vw, 352px'
              }
              className="size-full transition-transform duration-200 group-hover/tile:scale-[1.02] motion-reduce:transition-none"
            />
            {isVideo(m) && <PlayBadge />}
          </button>
        ))}
      </div>
    )
  }

  return <Carousel postId={postId} media={media} onOpen={onOpen} tileRef={tileRef} />
}

function isVideo(m: PostMedia): boolean {
  return m.mime.startsWith('video/')
}

function PlayBadge() {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
        <Play className="ml-0.5 size-6 fill-current" aria-hidden />
      </span>
    </span>
  )
}

/** Сдвиг пальцем, после которого жест считается листанием, а не нажатием. */
const SWIPE_PX = 40

/**
 * Карусель в духе Instagram: один кадр целиком, стрелки на десктопе, свайп на телефоне,
 * точки и счётчик «2/6», стрелки клавиатуры при фокусе на галерее.
 *
 * Высота постоянная — по пропорции первого кадра (не уже 4:5, не шире 16:9) под общим
 * потолком: при листании карточка не меняет высоту. Кадры вписываются целиком (`contain`)
 * поверх своей размытой копии. В DOM — только текущий кадр и соседи: соседей браузер
 * загружает заранее, остальные не тянутся вовсе.
 */
function Carousel({
  postId,
  media,
  onOpen,
  tileRef,
}: {
  postId: string
  media: readonly PostMedia[]
  onOpen: (index: number) => void
  tileRef: (index: number, el: HTMLElement | null) => void
}) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState(0)
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiped = useRef(false)
  const count = media.length
  const first = media[0]
  const ratio = first ? clamp(ratioOf(first), 0.8, 16 / 9) : 4 / 3

  const go = (next: number): void => setIndex(clamp(next, 0, count - 1))

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (e.pointerType === 'mouse') return
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    swiped.current = false
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!swiped.current) {
      // Направление решается после первых пикселей: дрожь пальца — ещё не жест.
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      // Вертикальный жест — прокрутка ленты, его не перехватываем.
      if (Math.abs(dy) > Math.abs(dx)) {
        start.current = null
        setDrag(0)
        return
      }
      swiped.current = true
    }
    // У краёв набора — тугая резинка, а не пустота за последним кадром.
    const edge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0)
    setDrag(edge ? dx / 3 : dx)
  }
  function onPointerEnd(): void {
    if (!start.current) return
    start.current = null
    if (drag <= -SWIPE_PX) go(index + 1)
    else if (drag >= SWIPE_PX) go(index - 1)
    setDrag(0)
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(index + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(index - 1)
    }
  }

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={t('mediaPosition', { current: index + 1, total: count })}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ aspectRatio: ratio }}
      className={cn(
        'group/gallery relative w-full touch-pan-y overflow-hidden bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        MEDIA_MAX_H,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className={cn(
          'flex h-full will-change-transform',
          drag === 0 &&
            'transition-transform duration-(--motion-panel) ease-(--motion-ease) motion-reduce:transition-none',
        )}
        style={{ transform: `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)` }}
      >
        {media.map((m, i) => (
          <div key={m.id} className="relative h-full w-full shrink-0" aria-hidden={i !== index}>
            {Math.abs(i - index) <= 1 && (
              <button
                type="button"
                ref={(el) => tileRef(i, el)}
                tabIndex={i === index ? 0 : -1}
                onClick={() => {
                  // Нажатие в конце свайпа — не открытие.
                  if (swiped.current) return
                  onOpen(i)
                }}
                aria-label={`${t('openMedia')} · ${i + 1}/${count}`}
                className="block size-full cursor-zoom-in focus-visible:outline-none"
              >
                <MediaFrame
                  postId={postId}
                  media={m}
                  className="size-full"
                  imageClassName="size-full"
                />
                {isVideo(m) && <PlayBadge />}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Счётчик — в правом верхнем углу, как в Instagram. */}
      <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
        {index + 1}/{count}
      </span>

      {/* Стрелки — только на устройствах с курсором: на телефоне листают пальцем. */}
      {index > 0 && (
        <CarouselArrow side="left" label={tCommon('previous')} onClick={() => go(index - 1)} />
      )}
      {index < count - 1 && (
        <CarouselArrow side="right" label={tCommon('next')} onClick={() => go(index + 1)} />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1">
        {media.map((m, i) => (
          <span
            key={m.id}
            className={cn(
              'size-1.5 rounded-full bg-white shadow-sm transition-opacity duration-150',
              i === index ? 'opacity-100' : 'opacity-50',
            )}
          />
        ))}
      </div>
    </div>
  )
}

function CarouselArrow({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity duration-150 hover:bg-background focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none pointer-fine:flex',
        'opacity-0 group-hover/gallery:opacity-100 group-focus-within/gallery:opacity-100',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {side === 'left' ? (
        <ChevronLeft className="size-5" aria-hidden />
      ) : (
        <ChevronRight className="size-5" aria-hidden />
      )}
    </button>
  )
}
