'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslations } from 'next-intl'
import { BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  MediaViewer as PlainMediaViewer,
} from '../../../shared/ui'
import {
  createSpring,
  identityColor,
  identityInitials,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Шапка профиля правой колонки (Telegram-стиль).
 *
 * Свёрнутый вид — крупный круглый аватар по центру, под ним имя и статус. Нажатие на аватар
 * (или прокрутка вверх за край) разворачивает фото во всю ширину колонки: квадрат, имя и
 * статус поверх затемнения снизу, полоски-индикаторы сверху, если фото несколько. Фото
 * листаются нажатием на левую/правую четверть, стрелками клавиатуры и жестом пальцем.
 * Прокрутка колонки вниз сворачивает фото обратно.
 *
 * Переход круг ↔ квадрат — View Transitions браузера: оба состояния помечены одним
 * `view-transition-name`, и браузер сам переносит снимок из одной геометрии в другую,
 * не двигая раскладку покадрово. Нет API или включено «уменьшить движение» — смена сразу.
 */

/** Ширина кадра ленты; 0 до раскладки заменяем единицей, чтобы не делить на ноль. */
function widthOf(el: HTMLElement | null): number {
  return el?.offsetWidth || 1
}

/** Имя перехода у аватара и развёрнутого фото: одно на документ (панель всегда одна). */
const PHOTO_TRANSITION = 'chat-profile-photo'

/** Сменить состояние через View Transition, если браузер умеет и движение не урезано. */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }
  doc.startViewTransition(() => flushSync(update))
}

export function ProfileHero({
  id,
  title,
  photos,
  status,
  online = false,
  official = false,
  officialLabel,
  expanded,
  onExpand,
}: {
  /** id чата — от него цвет кружка с инициалами. */
  id: string
  title: string
  /** Фото по порядку; пусто — кружок с инициалами, развернуть нечего. */
  photos: string[]
  status: string | null
  /** Собеседник в сети: статус окрашивается в акцент. */
  online?: boolean
  official?: boolean
  officialLabel: string
  expanded: boolean
  onExpand: () => void
}) {
  const t = useTranslations('Chats')
  const [viewer, setViewer] = useState<number | null>(null)
  const canExpand = photos.length > 0

  const name = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate">{title}</span>
      {official && (
        <BadgeCheck
          className={cn('size-5 shrink-0', expanded ? 'text-white' : 'text-info')}
          aria-label={officialLabel}
        />
      )}
    </span>
  )

  return (
    <>
      {expanded && canExpand ? (
        <PhotoCarousel
          photos={photos}
          title={title}
          name={name}
          status={status}
          onOpen={setViewer}
        />
      ) : (
        <div className="flex flex-col items-center px-4 pt-6 pb-4 text-center">
          {canExpand ? (
            <button
              type="button"
              aria-label={t('tgRight.expandPhoto')}
              onClick={onExpand}
              style={{ viewTransitionName: PHOTO_TRANSITION }}
              className="cursor-pointer rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
            >
              <Avatar className="size-30">
                <AvatarImage src={photos[0]} alt={title} className="object-cover" />
                <AvatarFallback
                  className={cn('text-4xl font-medium text-white', identityColor(id))}
                >
                  {identityInitials(title)}
                </AvatarFallback>
              </Avatar>
            </button>
          ) : (
            <Avatar className="size-30">
              <AvatarFallback className={cn('text-4xl font-medium text-white', identityColor(id))}>
                {identityInitials(title)}
              </AvatarFallback>
            </Avatar>
          )}
          <h2 className="mt-3 flex max-w-full justify-center text-xl font-semibold leading-tight">
            {name}
          </h2>
          {status && (
            <p className={cn('mt-1 text-sm', online ? 'text-primary' : 'text-muted-foreground')}>
              {status}
            </p>
          )}
        </div>
      )}

      {viewer !== null && photos[viewer] && (
        <PlainMediaViewer
          items={photos.map(() => ({ mime: 'image/*', name: title }))}
          index={viewer}
          src={photos[viewer]}
          onIndexChange={setViewer}
          onClose={() => setViewer(null)}
          downloadName={title}
        />
      )}
    </>
  )
}

/**
 * Развёрнутое фото: квадрат на всю ширину колонки и лента снимков внутри него.
 *
 * Лента едет пружиной (DESIGN_SYSTEM §7.1): палец ведёт её 1:1, за первым и последним
 * снимком — резина, отпускание решает по спроецированной точке остановки, а скорость пальца
 * переходит в доводку. Мышь и клавиатура листают нажатием — у них жеста нет.
 */
function PhotoCarousel({
  photos,
  title,
  name,
  status,
  onOpen,
}: {
  photos: string[]
  title: string
  name: React.ReactNode
  status: string | null
  onOpen: (index: number) => void
}) {
  const t = useTranslations('Chats')
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const frameRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const springRef = useRef<SpringHandle | null>(null)
  // Только что тянули пальцем — следующий click (его шлёт браузер по отпусканию) не открывает
  // просмотрщик: человек листал, а не выбирал.
  const draggedAt = useRef(0)
  const count = photos.length

  const render = useCallback((x: number) => {
    const strip = stripRef.current
    if (strip) strip.style.transform = `translate3d(${x}px, 0, 0)`
  }, [])

  useEffect(() => {
    const spring = createSpring({ from: 0, damping: 1, response: 0.35, onChange: render })
    springRef.current = spring
    // Ширина колонки меняется (окно, док/поверх) — снимок встаёт на место без анимации.
    const frame = frameRef.current
    const ro =
      frame && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            spring.set(-indexRef.current * widthOf(frameRef.current))
            render(spring.value)
          })
        : null
    if (frame) ro?.observe(frame)
    return () => {
      spring.stop()
      ro?.disconnect()
    }
  }, [render])

  const goTo = useCallback(
    (next: number, velocity?: number) => {
      const i = Math.max(0, Math.min(count - 1, next))
      indexRef.current = i
      setIndex(i)
      const spring = springRef.current
      if (!spring) return
      const target = -i * widthOf(frameRef.current)
      if (prefersReducedMotion()) {
        spring.set(target)
        render(target)
        return
      }
      spring.to(target, velocity)
    },
    [count, render],
  )

  // Жест пальцем/стилусом. Мышь сюда не ходит: тянуть мышью фото никто не ждёт, а нажатие
  // по краю у неё и так листает.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || count < 2) return
    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let base = 0
    let axis: 'x' | 'y' | null = null
    let history: { position: number; time: number }[] = []

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      axis = null
      history = [{ position: e.clientX, time: e.timeStamp }]
    }
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Вертикальное движение — это прокрутка колонки, ленту не трогаем.
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (axis === 'y') {
          pointerId = null
          return
        }
        const spring = springRef.current
        // Перехват на лету: база — текущее экранное положение, а не логический индекс.
        spring?.stop()
        base = spring?.value ?? -indexRef.current * widthOf(frameRef.current)
        frame.setPointerCapture(e.pointerId)
      }
      history.push({ position: e.clientX, time: e.timeStamp })
      if (history.length > 8) history.shift()
      const w = widthOf(frameRef.current)
      const min = -(count - 1) * w
      let x = base + dx
      if (x > 0) x = rubberband(x, w)
      else if (x < min) x = min - rubberband(min - x, w)
      springRef.current?.set(x)
      render(x)
    }
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      pointerId = null
      if (frame.hasPointerCapture(e.pointerId)) frame.releasePointerCapture(e.pointerId)
      if (axis !== 'x') return
      draggedAt.current = performance.now()
      const velocity = velocityFrom(history)
      const x = springRef.current?.value ?? 0
      // Решение по точке, где лента остановилась бы сама: короткий флик листает, вялое
      // перетаскивание на полкадра — нет. Дальше соседнего снимка за один жест не уезжаем.
      const projected = x + projectMomentum(velocity, 0.99)
      const target = Math.round(-projected / widthOf(frameRef.current))
      const current = indexRef.current
      goTo(Math.max(current - 1, Math.min(current + 1, target)), velocity)
    }

    frame.addEventListener('pointerdown', onDown)
    frame.addEventListener('pointermove', onMove)
    frame.addEventListener('pointerup', onUp)
    frame.addEventListener('pointercancel', onUp)
    return () => {
      frame.removeEventListener('pointerdown', onDown)
      frame.removeEventListener('pointermove', onMove)
      frame.removeEventListener('pointerup', onUp)
      frame.removeEventListener('pointercancel', onUp)
    }
  }, [count, goTo, render])

  const open = (): void => {
    if (performance.now() - draggedAt.current < 400) return
    onOpen(indexRef.current)
  }

  return (
    <div
      ref={frameRef}
      role="group"
      aria-roledescription={t('tgRight.photoCarousel')}
      aria-label={t('tgRight.photoOf', { current: index + 1, total: count })}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          goTo(indexRef.current - 1)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          goTo(indexRef.current + 1)
        }
      }}
      style={{ viewTransitionName: PHOTO_TRANSITION }}
      className="relative aspect-square w-full touch-pan-y overflow-hidden bg-muted select-none"
    >
      <div ref={stripRef} className="flex size-full will-change-transform">
        {photos.map((src, i) => (
          <div key={src} className="relative size-full shrink-0" aria-hidden={i !== index}>
            {/* Публичный URL аватара/обложки: next/image для таких ссылок в чатах не используется. */}
            <img
              src={src}
              alt={i === index ? title : ''}
              draggable={false}
              className="size-full object-cover"
            />
          </div>
        ))}
      </div>

      {/* Нажатие по середине — фото во весь экран. Кнопка под краевыми зонами: они перехватывают
          свои четверти, остальное попадает сюда. */}
      <button
        type="button"
        aria-label={t('tgRight.photoOpen')}
        onClick={open}
        className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-ring/40"
      />

      {count > 1 && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 bg-gradient-to-b from-black/30 to-transparent px-2 pt-2 pb-6"
          aria-hidden
        >
          {photos.map((src, i) => (
            <span
              key={src}
              className={cn(
                'h-0.5 flex-1 rounded-full bg-white transition-opacity duration-(--motion-control)',
                i === index ? 'opacity-80' : 'opacity-30',
              )}
            />
          ))}
        </div>
      )}

      {index > 0 && (
        <EdgeButton side="prev" label={t('tgRight.photoPrev')} onClick={() => goTo(index - 1)} />
      )}
      {index < count - 1 && (
        <EdgeButton side="next" label={t('tgRight.photoNext')} onClick={() => goTo(index + 1)} />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-5 pt-16 pb-3 text-white">
        <h2 className="flex text-xl font-semibold leading-tight">{name}</h2>
        {status && <p className="mt-0.5 text-sm text-white/75">{status}</p>}
      </div>
    </div>
  )
}

/** Левая/правая четверть фото — листание. Стрелка видна под курсором и на фокусе. */
function EdgeButton({
  side,
  label,
  onClick,
}: {
  side: 'prev' | 'next'
  label: string
  onClick: () => void
}) {
  const Icon = side === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'absolute inset-y-0 z-[1] flex w-1/4 items-center px-3 text-white outline-none',
        side === 'prev' ? 'left-0 justify-start' : 'right-0 justify-end',
        // На тач-экране стрелки не нужны (листают пальцем), под курсором — проявляются.
        'opacity-0 transition-opacity duration-(--motion-micro) focus-visible:opacity-100 [@media(hover:hover)]:hover:opacity-100',
      )}
    >
      <Icon className="size-7 drop-shadow" aria-hidden />
    </button>
  )
}
