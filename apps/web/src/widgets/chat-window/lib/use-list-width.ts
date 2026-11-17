'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

// Ширина колонки списка чатов на ПК (как в Telegram): тянется за край, двойной щелчок
// возвращает умолчание, выбор запоминается. Сдвинутая уже порога колонка сворачивается до
// аватаров; оттянутая обратно — разворачивается.
//
// Колонка живёт в сайдбаре оболочки (портал в слот), поэтому ширина уходит туда CSS-
// переменной на корне документа (`--chat-list-w`), а свёрнутость — атрибутом
// `data-chat-list-compact`: оболочка прячет по нему подписи плашки профиля. Обе метки
// снимаются, когда экран чатов уходит, — на других страницах сайдбар прежний.
//
// Размер — удобство одного человека на одном устройстве, не данные сессии: localStorage
// здесь уместен (FRONTEND_RULES §1 запрещает там только токены и данные сессии).
//
// Автосвёртка (как Telegram на узком десктопе): окно уже AUTO_COMPACT_BELOW — колонка сама
// сворачивается до аватаров, чтобы переписке хватило места. Это не выбор человека, и в
// хранилище он не пишется: окно расширили — вернулась запомненная ширина. Развернул колонку
// сам (кнопкой, ручкой, клавишей) — она остаётся развёрнутой, пока окно снова не станет
// широким: решение человека важнее автоматики, но только для этого «узкого» эпизода.

const STORAGE_KEY = 'sh.chats.listWidth'
/** Умолчание — прежняя ширина сайдбара (`w-72`). */
export const LIST_DEFAULT_W = 288
/** Уже — строки списка не помещают имя и время. */
const LIST_MIN_W = 256
/** Шире — переписке не остаётся места; плюс потолок в 40% окна. */
export const LIST_MAX_W = 424
/** Свёрнутая колонка: аватар 48 px и поля. */
export const LIST_COMPACT_W = 76
/** Отпущенная уже этого колонка сворачивается до аватаров. */
const COLLAPSE_AT = 200
/** Шаг клавиатуры (стрелки на ручке). */
const KEY_STEP = 16
/**
 * Уже этого окна колонка сворачивается сама. Сайдбар со списком появляется с 1024 px; до
 * 1200 px переписке за развёрнутой колонкой остаётся меньше 900 px — тесно для пузырей с
 * медиа и правой колонки.
 */
export const AUTO_COMPACT_BELOW = 1200

function isNarrowWindow(): boolean {
  return window.innerWidth < AUTO_COMPACT_BELOW
}

function maxWidth(): number {
  return Math.max(LIST_MIN_W, Math.min(LIST_MAX_W, Math.round(window.innerWidth * 0.4)))
}

function clampWidth(w: number): number {
  return Math.min(Math.max(Math.round(w), LIST_MIN_W), maxWidth())
}

function readStored(): number | 'compact' | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'compact') return 'compact'
    const n = Number(raw)
    return raw && Number.isFinite(n) && n > 0 ? n : null
  } catch {
    // Хранилище закрыто (приватный режим, запрет сайта) — просто умолчание.
    return null
  }
}

function writeStored(value: number | 'compact' | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // Не запомнилось — на этом устройстве ширина вернётся к умолчанию, работе это не мешает.
  }
}

function applyToDocument(width: number, compact: boolean): void {
  const root = document.documentElement
  root.style.setProperty('--chat-list-w', `${compact ? LIST_COMPACT_W : width}px`)
  if (compact) root.setAttribute('data-chat-list-compact', '')
  else root.removeAttribute('data-chat-list-compact')
}

function clearDocument(): void {
  const root = document.documentElement
  root.style.removeProperty('--chat-list-w')
  root.removeAttribute('data-chat-list-compact')
}

export interface ChatListWidth {
  compact: boolean
  /** Ширина развёрнутой колонки, px (для aria-valuenow). */
  width: number
  /** Развернуть свёрнутую колонку (кнопка над аватарами). */
  expand: () => void
  /** Свойства ручки на правом краю колонки. */
  handleProps: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    onPointerMove: (e: PointerEvent<HTMLElement>) => void
    onPointerUp: (e: PointerEvent<HTMLElement>) => void
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void
    onDoubleClick: () => void
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  }
}

/** `enabled` — колонка списка сейчас в сайдбаре ПК; иначе метки на документе не ставим. */
export function useChatListWidth(enabled: boolean): ChatListWidth {
  const [compact, setCompact] = useState(false)
  const [width, setWidth] = useState(LIST_DEFAULT_W)
  // Живые значения для перетаскивания: пишем в документ на каждом движении, а состояние
  // React трогаем только при смене режима (свёрнута/развёрнута) и в конце жеста.
  const widthRef = useRef(LIST_DEFAULT_W)
  // Свёрнута руками (это и запоминается).
  const compactRef = useRef(false)
  // Окно узкое, и человек в этом «узком» эпизоде колонку сам не разворачивал.
  const narrowRef = useRef(false)
  const keepOpenRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null)

  /** Свёрнута ли колонка на экране: руками или автоматикой. */
  const shownCompact = useCallback(
    (): boolean => compactRef.current || (narrowRef.current && !keepOpenRef.current),
    [],
  )

  const apply = useCallback((): void => {
    const effective = shownCompact()
    applyToDocument(widthRef.current, effective)
    setCompact(effective)
  }, [shownCompact])

  const set = useCallback(
    (nextWidth: number, nextCompact: boolean): void => {
      widthRef.current = nextWidth
      compactRef.current = nextCompact
      // Развернул сам на узком окне — автоматика на этот эпизод отступает.
      if (!nextCompact && narrowRef.current) keepOpenRef.current = true
      apply()
    },
    [apply],
  )

  const persist = useCallback((): void => {
    setWidth(widthRef.current)
    writeStored(compactRef.current ? 'compact' : widthRef.current)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const stored = readStored()
    narrowRef.current = isNarrowWindow()
    keepOpenRef.current = false
    widthRef.current = typeof stored === 'number' ? clampWidth(stored) : LIST_DEFAULT_W
    compactRef.current = stored === 'compact'
    apply()
    setWidth(widthRef.current)
    // Окно сузили — колонка не должна съесть переписку; совсем узкое — сворачивается сама.
    const onResize = (): void => {
      const narrow = isNarrowWindow()
      const clamped = clampWidth(widthRef.current)
      if (narrow === narrowRef.current && clamped === widthRef.current) return
      // Окно снова широкое — «узкий» эпизод кончился, ручное «развернуть» забываем.
      if (!narrow) keepOpenRef.current = false
      narrowRef.current = narrow
      widthRef.current = clamped
      apply()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearDocument()
    }
  }, [enabled, apply])

  const endDrag = (e: PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
    persist()
  }

  const handleProps: ChatListWidth['handleProps'] = {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startW: shownCompact() ? LIST_COMPACT_W : widthRef.current,
      }
      // Курсор и запрет выделения — на всё окно: указатель уходит с узкой ручки сразу.
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    },
    onPointerMove: (e) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const raw = drag.startW + (e.clientX - drag.startX)
      if (raw < COLLAPSE_AT) {
        // Колонку свернула автоматика, и её ещё не вытянули — ручным «свернуть» дрожание
        // указателя у края не считаем, иначе оно запомнилось бы.
        if (!compactRef.current && narrowRef.current && !keepOpenRef.current) return
        set(widthRef.current, true)
      } else set(clampWidth(raw), false)
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: () => {
      set(LIST_DEFAULT_W, false)
      setWidth(LIST_DEFAULT_W)
      writeStored(null)
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        if (shownCompact()) {
          if (dir > 0) set(widthRef.current, false)
        } else if (dir < 0 && widthRef.current <= LIST_MIN_W) {
          set(widthRef.current, true)
        } else {
          set(clampWidth(widthRef.current + dir * KEY_STEP), false)
        }
        persist()
      } else if (e.key === 'Home') {
        e.preventDefault()
        set(widthRef.current, true)
        persist()
      } else if (e.key === 'End') {
        e.preventDefault()
        set(maxWidth(), false)
        persist()
      }
    },
  }

  const expand = useCallback((): void => {
    set(widthRef.current, false)
    persist()
  }, [set, persist])

  return { compact: enabled && compact, width, expand, handleProps }
}
