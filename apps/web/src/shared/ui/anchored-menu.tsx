'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { prefersReducedMotion } from '../lib'
import { cn } from '../lib/utils'

/**
 * Элемент, из которого выросло меню (долгое нажатие на телефоне): сообщение в ленте, строка
 * списка чатов, карточка уведомления. Меню поднимает его снимок над размытым фоном, поэтому ему
 * нужны и живой узел (для клона), и экранная геометрия на момент нажатия.
 */
export interface MenuAnchor {
  node: HTMLElement
  rect: { top: number; left: number; width: number; height: number }
}

/** Снять якорь с узла. Геометрию фиксируем сразу: список под затемнением может уехать. */
export function captureAnchor(node: HTMLElement | null | undefined): MenuAnchor | undefined {
  if (!node) return undefined
  const r = node.getBoundingClientRect()
  return { node, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }
}

/** Отступ от краёв экрана и зазор между блоками раскладки. */
const EDGE = 12
const GAP = 8
/** Ниже этого снимок не ужимаем — он становится прокручиваемым. */
const MIN_SNAPSHOT = 96
/** Длительность ухода слоя — столько же ждёт `useDismissAnimation` перед размонтированием. */
const EXIT_MS = 150

/**
 * Снимок элемента над затемнением: клон живого узла, а не пересборка разметки.
 *
 * Клон, потому что элемент — это уже отрисованный кусок интерфейса со всем, что в нём бывает
 * (вложения, цитата, опрос, аватар, счётчики), и повторять эту сборку вторым кодом значит
 * гарантированно разойтись с оригиналом. Клон инертен: обработчики React на него не переносятся,
 * а кнопки, которые показывает `group-hover`, остаются невидимыми — группы-родителя здесь нет.
 */
function Snapshot({ node }: { node: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const clone = node.cloneNode(true) as HTMLElement
    // Ширину задаёт снимок (она измерена у оригинала): относительные ограничения вроде
    // `max-w-[75%]` внутри клона считались бы от ширины оверлея, и элемент стал бы шире,
    // чем был под пальцем.
    clone.style.maxWidth = 'none'
    clone.style.width = '100%'
    clone.style.transform = ''
    clone.removeAttribute('id')
    el.replaceChildren(clone)
  }, [node])

  return <div ref={host} aria-hidden />
}

/** Куда встали снимок, верхняя плашка и карточка действий. */
interface Placement {
  snapshotTop: number
  snapshotHeight: number
  aboveTop: number
  cardTop: number
}

/**
 * Меню у самого элемента (Telegram-стиль) — мобильный слой контекстных меню.
 *
 * Нижний лист, который был здесь раньше, отрывал действия от того, к чему они относятся: палец
 * на одном краю экрана, сообщение или строка — на другом, да ещё и наполовину закрыты самим
 * листом. Здесь элемент остаётся на своём месте и чётким над размытым фоном, а действия растут
 * прямо от него: связь «что именно я сейчас держу» не теряется.
 *
 * Раскладка считается от прямоугольника якоря: не хватает места сверху или снизу — снимок
 * плавно отъезжает, освобождая место; не влезает по высоте — ужимается и прокручивается внутри.
 */
export function AnchoredMenuLayer({
  anchor,
  fallbackY,
  align,
  above,
  card,
  closing,
  snapshotClassName,
  onBackdropTap,
}: {
  /** Якорь есть только у жеста по элементу; без него меню встаёт у точки нажатия. */
  anchor?: MenuAnchor | null
  /** Вертикаль точки нажатия — запасной якорь нулевой высоты. */
  fallbackY: number
  /** Сторона, к которой прижаты плашка и карточка: у своих сообщений — правая. */
  align: 'start' | 'end'
  /** Плашка над снимком (быстрые реакции у сообщения). */
  above?: ReactNode
  /** Карточка действий под снимком. */
  card: ReactNode
  /** Слой уходит: играем анимацию ухода вместо появления. */
  closing?: boolean
  /** Оформление снимка — строке списка идёт скруглённая карточка, пузырю сообщения не нужна. */
  snapshotClassName?: string
  /** Тап по снимку = тап мимо меню: элемент под пальцем неинтерактивен. */
  onBackdropTap: () => void
}) {
  const aboveRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Placement | null>(null)
  // Сдвиг снимка от исходного места: элемент у края экрана уезжает, освобождая место
  // действиям, — но уезжает плавно, а не телепортируется.
  const [lift, setLift] = useState(0)
  // Первый кадр раскладка встаёт как есть; переезды (раскрытый вложенный список меняет высоту
  // карточки) уже едут переходом. Без флага блоки приезжали бы из-за экрана.
  const [ready, setReady] = useState(false)

  const anchorTop = anchor?.rect.top ?? fallbackY
  const anchorHeight = anchor?.rect.height ?? 0

  useLayoutEffect(() => {
    const measure = (): void => {
      const cardEl = cardRef.current
      if (!cardEl) return
      const cardH = cardEl.offsetHeight
      // На ПК слой скрыт (display:none) — мерить нечего, раскладка не нужна.
      if (!cardH) return
      const aboveH = aboveRef.current?.offsetHeight ?? 0
      const aboveBlock = aboveH ? aboveH + GAP : 0

      const vh = window.innerHeight
      const free = vh - 2 * EDGE - aboveBlock - cardH - GAP
      const snapshotHeight = Math.min(anchorHeight, Math.max(free, MIN_SNAPSHOT))
      const minTop = EDGE + aboveBlock
      const maxTop = Math.max(minTop, vh - EDGE - cardH - GAP - snapshotHeight)
      const snapshotTop = Math.min(Math.max(anchorTop, minTop), maxTop)

      setPlace({
        snapshotTop,
        snapshotHeight,
        aboveTop: snapshotTop - GAP - aboveH,
        cardTop: snapshotTop + snapshotHeight + GAP,
      })
    }

    measure()
    const cardEl = cardRef.current
    if (!cardEl || typeof ResizeObserver === 'undefined') return
    // Карточка меняет высоту на ходу (вложенный список папок раскрывается на месте) —
    // без наблюдателя она уезжала бы за нижний край, а снимок оставался бы на старом месте.
    const ro = new ResizeObserver(measure)
    ro.observe(cardEl)
    if (aboveRef.current) ro.observe(aboveRef.current)
    return () => ro.disconnect()
  }, [anchorTop, anchorHeight])

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!place) return
    const delta = place.snapshotTop - anchorTop
    if (prefersReducedMotion()) {
      setLift(delta)
      return
    }
    // Кадр задержки обязателен: поставь конечное значение в том же кадре, что и начальное, —
    // браузеру не между чем интерполировать, и перехода просто не будет.
    const id = requestAnimationFrame(() => setLift(delta))
    return () => cancelAnimationFrame(id)
  }, [place, anchorTop])

  const move = ready && !prefersReducedMotion()
  const enter = closing ? 'animate-out fade-out zoom-out-95' : 'animate-in fade-in zoom-in-95'

  return (
    <div className="absolute inset-0 md:hidden">
      {anchor && (
        <div
          className={cn(
            'absolute overflow-y-auto overscroll-contain touch-pan-y',
            closing && 'duration-150 animate-out fade-out',
            snapshotClassName,
          )}
          style={{
            left: anchor.rect.left,
            top: anchor.rect.top,
            width: anchor.rect.width,
            maxHeight: place?.snapshotHeight,
            transform: lift ? `translateY(${lift}px)` : undefined,
            transition: move ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
          }}
          onClick={onBackdropTap}
        >
          <Snapshot node={anchor.node} />
        </div>
      )}
      {/* Обёртки во всю ширину только позиционируют — тап мимо плашки должен закрывать меню,
          поэтому события ловит не обёртка, а сама плашка. */}
      {above && (
        <div
          ref={aboveRef}
          style={{
            top: place?.aboveTop ?? -9999,
            transition: move ? 'top 200ms ease-out' : undefined,
          }}
          className={cn(
            'pointer-events-none absolute inset-x-3 flex',
            align === 'end' ? 'justify-end' : 'justify-start',
          )}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'pointer-events-auto max-w-full duration-200',
              enter,
              align === 'end' ? 'origin-bottom-right' : 'origin-bottom-left',
            )}
          >
            {above}
          </div>
        </div>
      )}
      <div
        ref={cardRef}
        style={{
          top: place?.cardTop ?? -9999,
          transition: move ? 'top 200ms ease-out' : undefined,
        }}
        className={cn(
          'pointer-events-none absolute inset-x-3 flex',
          align === 'end' ? 'justify-end' : 'justify-start',
        )}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'pointer-events-auto max-h-[80dvh] w-60 max-w-full overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover/95 shadow-xl backdrop-blur-md duration-200',
            enter,
            align === 'end' ? 'origin-top-right' : 'origin-top-left',
          )}
        >
          {card}
        </div>
      </div>
    </div>
  )
}

export { EXIT_MS as MENU_EXIT_MS }
