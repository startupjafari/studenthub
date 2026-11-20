'use client'

// Лента сообщений без виртуализации — как в Telegram Web. В DOM живёт ограниченное окно
// переписки (см. lib/message-window), а видимая позиция держится за «якорь»: верхнее
// сообщение в кадре. Что бы ни случилось с лентой — догрузилась история сверху, отрезался
// край окна, выросла картинка или карточка ссылки выше кадра, — после изменения якорь
// возвращается туда, где был, и под глазами у человека ничего не сдвигается.
//
// Почему не virtua: виртуализатор раскладывает невидимые строки по оценке высоты и уточняет
// её, когда строка въезжает в кадр. В ленте с картинками, голосовыми и карточками оценка
// почти всегда врёт, и каждое уточнение выше кадра — прыжок контента; при быстрой прокрутке
// вверх их были десятки в секунду, а низ кадра временами оставался пустым.
//
// Нативный `overflow-anchor` делает то же самое, но не в Safari, и спорит с ручной
// прокруткой ленты — поэтому он выключен, а якорь ведётся здесь.

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { MediaNearProvider } from '../../../entities/chat'
import { scrollTargetFor, type MessageWindowHandle } from '../lib/message-window'

export type { MessageWindowHandle } from '../lib/message-window'

interface Anchor {
  key: string
  /** Верх строки относительно верха контейнера прокрутки. */
  top: number
  /** scrollTop в момент замера: изменился — значит, ленту прокрутили, и замер устарел. */
  scrollTop: number
}

export interface MessageWindowProps {
  ref?: Ref<MessageWindowHandle>
  /** Контейнер прокрутки ленты. */
  scrollRef: RefObject<HTMLElement | null>
  /**
   * Держать низ вместо якоря: человек стоит у последнего сообщения, и выросшая снизу
   * картинка не должна уводить его выше. Новое последнее сообщение сюда не относится — его
   * доводит до кадра сама лента, плавно.
   */
  stickToBottom: () => boolean
  children: ReactNode
}

const KEY_ATTR = 'data-window-key'

/**
 * Запас вокруг кадра, в котором строка считается «рядом» и грузит медиа. Узкий: каждая ссылка
 * на вложение — отдельный запрос к API с общим лимитом в минуту, и широкая зона при быстрой
 * прокрутке съедала его на медиа, которое человек так и не увидел.
 */
const NEAR_MARGIN = '25% 0px'
/**
 * Сколько строка должна пробыть рядом с кадром, прежде чем грузить медиа. При быстрой
 * прокрутке строки пролетают быстрее — и не тратят запросы (Telegram: тот же приём).
 */
const NEAR_DWELL_MS = 300

type NearRegistry = {
  observe: (el: Element, onNear: () => void) => () => void
}
const NearContext = createContext<NearRegistry | null>(null)

/**
 * Один IntersectionObserver на ленту. Строка становится «рядом», только пробыв в зоне
 * NEAR_DWELL_MS без перерыва. Однажды «рядом» — навсегда: уже загруженное медиа не выгружаем.
 */
function useNearRegistry(scrollRef: RefObject<HTMLElement | null>): NearRegistry | null {
  const [registry, setRegistry] = useState<NearRegistry | null>(null)
  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const callbacks = new Map<Element, () => void>()
    // Строка в зоне → когда вошла. «Рядом» становится только та, что пробыла в зоне весь
    // NEAR_DWELL_MS: при быстром пролёте строки выходят раньше и запросов не тратят.
    const inside = new Map<Element, number>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (): void => {
      if (timer !== null || inside.size === 0) return
      const now = performance.now()
      let soonest = Number.POSITIVE_INFINITY
      for (const at of inside.values()) soonest = Math.min(soonest, at + NEAR_DWELL_MS)
      timer = setTimeout(flush, Math.max(0, soonest - now))
    }
    const flush = (): void => {
      timer = null
      const now = performance.now()
      for (const [el, at] of inside) {
        if (now - at < NEAR_DWELL_MS) continue
        const cb = callbacks.get(el)
        inside.delete(el)
        if (!cb) continue
        cb()
        callbacks.delete(el)
        io.unobserve(el)
      }
      schedule()
    }
    const io = new IntersectionObserver(
      (entries) => {
        const now = performance.now()
        for (const e of entries) {
          if (e.isIntersecting) {
            if (!inside.has(e.target)) inside.set(e.target, now)
          } else inside.delete(e.target)
        }
        schedule()
      },
      { root, rootMargin: NEAR_MARGIN },
    )
    setRegistry({
      observe(el, onNear) {
        callbacks.set(el, onNear)
        io.observe(el)
        return () => {
          callbacks.delete(el)
          inside.delete(el)
          io.unobserve(el)
        }
      },
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      io.disconnect()
      setRegistry(null)
    }
  }, [scrollRef])
  return registry
}

/**
 * Строка вне кадра не считается браузером вовсе — ни стили, ни раскладка, ни отрисовка
 * (`content-visibility: auto`). Это и есть дешёвая «виртуализация» Telegram-ленты: в DOM сотни
 * сообщений, а работы — как с экраном. Однажды показанная строка помнит свою высоту (`auto`
 * в contain-intrinsic-size), а уточнение высоты ещё не показанной гасит якорь окна.
 */
const ROW_STYLE = { contentVisibility: 'auto', containIntrinsicSize: 'auto 72px' } as const

/** Обёртка строки: ключ для якоря и флаг «рядом с кадром» для медиа внутри. */
function WindowRow({ rowKey, children }: { rowKey: string; children: ReactNode }) {
  const registry = useContext(NearContext)
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !registry || near) return
    return registry.observe(el, () => setNear(true))
  }, [registry, near])
  return (
    <div ref={ref} {...{ [KEY_ATTR]: rowKey }} style={ROW_STYLE}>
      {/* Без наблюдателя (тесты, старый браузер) — грузим сразу, как раньше. Пока сам
          наблюдатель ещё не создан (первый кадр ленты) — ждём его, а не грузим всё подряд. */}
      <MediaNearProvider near={near || typeof IntersectionObserver === 'undefined'}>
        {children}
      </MediaNearProvider>
    </div>
  )
}

export function MessageWindow({ ref, scrollRef, stickToBottom, children }: MessageWindowProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<Anchor | null>(null)
  const nearRegistry = useNearRegistry(scrollRef)
  const stickRef = useRef(stickToBottom)
  stickRef.current = stickToBottom

  const items = Children.toArray(children).filter(isValidElement)
  const keys = items.map((c) => String(c.key))
  const firstKey = keys[0] ?? null
  const lastKey = keys[keys.length - 1] ?? null
  const signature = `${keys.length}|${firstKey}|${lastKey}`

  const rows = useCallback((): HTMLElement[] => {
    const content = contentRef.current
    return content ? (Array.from(content.children) as HTMLElement[]) : []
  }, [])

  // Верх содержимого ленты в координатах прокрутки (отступ контейнера сверху).
  const base = useCallback((): number => {
    const sc = scrollRef.current
    const content = contentRef.current
    if (!sc || !content) return 0
    return content.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
  }, [scrollRef])

  // Двоичный поиск по offsetTop строк: в окне сотни строк, зовётся на каждом кадре.
  const findIndex = useCallback(
    (offset: number): number => {
      const list = rows()
      if (list.length === 0) return -1
      const b = base()
      let lo = 0
      let hi = list.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (b + (list[mid]?.offsetTop ?? 0) <= offset) lo = mid
        else hi = mid - 1
      }
      return lo
    },
    [rows, base],
  )

  const capture = useCallback((): void => {
    const sc = scrollRef.current
    if (!sc) return
    const list = rows()
    const idx = findIndex(sc.scrollTop)
    const el = idx >= 0 ? list[idx] : undefined
    if (!el) {
      anchorRef.current = null
      return
    }
    anchorRef.current = {
      key: el.getAttribute(KEY_ATTR) ?? '',
      top: base() + el.offsetTop - sc.scrollTop,
      scrollTop: sc.scrollTop,
    }
  }, [scrollRef, rows, findIndex, base])

  /**
   * Вернуть якорь на место после изменения ленты. `structural` — изменился состав строк, и
   * якорь снят прямо перед этим (при рендере); иначе (выросла строка) замер мог устареть:
   * если ленту с тех пор прокрутили, поправку не делаем, а только перемеряем.
   */
  const restore = useCallback(
    (structural: boolean): void => {
      const sc = scrollRef.current
      const anchor = anchorRef.current
      if (!sc) return
      if (stickRef.current()) {
        sc.scrollTop = sc.scrollHeight
        capture()
        return
      }
      if (!anchor || (!structural && Math.abs(sc.scrollTop - anchor.scrollTop) > 1)) {
        capture()
        return
      }
      const el = contentRef.current?.querySelector<HTMLElement>(
        `[${KEY_ATTR}="${CSS.escape(anchor.key)}"]`,
      )
      if (el) {
        const nowTop = base() + el.offsetTop - sc.scrollTop
        const delta = nowTop - anchor.top
        if (Math.abs(delta) >= 0.5) sc.scrollTop = sc.scrollTop + delta
      }
      capture()
    },
    [scrollRef, capture, base],
  )

  // Якорь — перед изменением состава строк. Рендер идёт до записи в DOM, поэтому здесь
  // ещё старая раскладка: ровно то, что видел человек.
  const prevSignatureRef = useRef(signature)
  const prevLastKeyRef = useRef(lastKey)
  if (prevSignatureRef.current !== signature && typeof window !== 'undefined') {
    // Замер по старому DOM; useLayoutEffect ниже поправит прокрутку до отрисовки кадра.
    capture()
  }

  useLayoutEffect(() => {
    if (prevSignatureRef.current === signature) return
    prevSignatureRef.current = signature
    const lastChanged = prevLastKeyRef.current !== lastKey
    prevLastKeyRef.current = lastKey
    // Новое последнее сообщение у стоящего внизу: якорь держит кадр, а к новому сообщению
    // ленту плавно доводит её владелец. Подтягивать низ здесь — значит прыгнуть без анимации.
    if (lastChanged && stickRef.current()) {
      capture()
      return
    }
    restore(true)
  }, [signature, lastKey, restore, capture])

  // Строки растут и после рендера: снимок догрузился, пришла карточка ссылки, реакция.
  useLayoutEffect(() => {
    const content = contentRef.current
    const sc = scrollRef.current
    if (!content || !sc) return
    sc.style.overflowAnchor = 'none'
    const onScroll = (): void => capture()
    sc.addEventListener('scroll', onScroll, { passive: true })
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => restore(false))
      ro.observe(content)
    }
    capture()
    return () => {
      sc.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [scrollRef, capture, restore])

  useImperativeHandle(
    ref,
    (): MessageWindowHandle => ({
      get scrollOffset() {
        return scrollRef.current?.scrollTop ?? 0
      },
      get viewportSize() {
        const sc = scrollRef.current
        if (!sc) return 0
        // Нижний отступ ленты — место под панелью ввода, она лежит поверх ленты.
        return sc.clientHeight - (Number.parseFloat(getComputedStyle(sc).paddingBottom) || 0)
      },
      findItemIndex: findIndex,
      getItemOffset(index: number) {
        const el = rows()[index]
        return el ? base() + el.offsetTop : 0
      },
      scrollToIndex(index, opts) {
        const sc = scrollRef.current
        const el = rows()[index]
        if (!sc || !el) return
        const style = getComputedStyle(sc)
        const padBottom = Number.parseFloat(style.paddingBottom) || 0
        const top = base() + el.offsetTop
        const target = scrollTargetFor(
          { top, height: el.offsetHeight },
          {
            scrollTop: sc.scrollTop,
            // Низ кадра — над панелью ввода: она лежит поверх ленты и занимает нижний отступ.
            height: sc.clientHeight - (opts?.align === 'end' ? padBottom : 0),
            maxScroll: sc.scrollHeight - sc.clientHeight,
          },
          opts?.align ?? 'start',
        )
        // Последняя строка «по низу» — это самый низ ленты, вместе с отступом под панель.
        const isLast = index === rows().length - 1 && opts?.align === 'end'
        const top2 = isLast ? sc.scrollHeight - sc.clientHeight : target
        if (opts?.smooth) sc.scrollTo({ top: top2, behavior: 'smooth' })
        else sc.scrollTop = top2
        capture()
      },
      scrollToBottom() {
        const sc = scrollRef.current
        if (!sc) return
        sc.scrollTop = sc.scrollHeight
        capture()
      },
    }),
    [scrollRef, rows, base, findIndex, capture],
  )

  return (
    <NearContext.Provider value={nearRegistry}>
      <div ref={contentRef} className="relative">
        {items.map((child) => (
          <WindowRow key={child.key} rowKey={String(child.key)}>
            {child}
          </WindowRow>
        ))}
      </div>
    </NearContext.Provider>
  )
}
