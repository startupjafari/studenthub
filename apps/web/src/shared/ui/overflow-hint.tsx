'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'

// Подсказка у обрезанного текста — во всём приложении одним обработчиком.
//
// Текст с многоточием (`truncate`, `line-clamp-*`, любой `text-overflow: ellipsis`) на
// наведении мыши или фокусе показывает полный текст с кнопкой «Копировать» — как
// `TableText` в таблицах. Подсказка только у реально обрезанного: на каждой строке она
// мешала бы. Отдельный компонент на каждое из трёх сотен мест — то же поведение, но
// новое место снова оставалось бы без подсказки; здесь его подхватывает само.
//
// Монтируется один раз в providers. Своя подсказка у элемента (TableText) или нежелание
// её видеть — `data-overflow-hint="off"` на нём или предке. Касание не обрабатываем:
// наведения на телефоне нет, а долгое нажатие занято системным выделением.

/** Пауза перед показом, мс: как у остальных подсказок (TooltipProvider). */
const SHOW_DELAY = 200
/** Пауза перед скрытием, мс: успеть довести курсор до кнопки «Копировать». */
const HIDE_DELAY = 150
/** Сколько предков проверять от элемента под курсором: курсор бывает на вложенном span. */
const MAX_DEPTH = 4
/** Отступ подсказки от текста и от краёв окна, px. */
const GAP = 6
const EDGE = 8

interface Hint {
  text: string
  rect: DOMRect
}

/**
 * Как обрезается текст элемента: в строку (`text-overflow: ellipsis`), по числу строк
 * (`line-clamp`) или никак.
 */
function clipKind(style: CSSStyleDeclaration): 'line' | 'lines' | null {
  if (style.textOverflow === 'ellipsis') return 'line'
  const clamp = style.getPropertyValue('-webkit-line-clamp')
  return clamp && clamp !== 'none' ? 'lines' : null
}

/** Ближайший обрезанный элемент от `start` вверх, если подсказка ему положена. */
function findClipped(start: Element | null): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : (start?.parentElement ?? null)
  for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable="true"]')) return null
    const kind = clipKind(getComputedStyle(el))
    if (!kind) continue
    // Многоточие задано, но текст влез — подсказка не нужна, и выше искать незачем.
    const clipped =
      kind === 'line' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1
    if (!clipped || el.closest('[data-overflow-hint="off"]')) return null
    return el.innerText.trim() ? el : null
  }
  return null
}

export function OverflowHint() {
  const t = useTranslations('Table')
  const [hint, setHint] = useState<Hint | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const target = useRef<HTMLElement | null>(null)
  const showTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)

  const hide = useCallback(() => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
    target.current = null
    setHint(null)
    setPos(null)
  }, [])

  const scheduleHide = useCallback(() => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(hide, HIDE_DELAY)
  }, [hide])

  const scheduleShow = useCallback((el: HTMLElement) => {
    window.clearTimeout(hideTimer.current)
    if (target.current === el) return
    window.clearTimeout(showTimer.current)
    target.current = el
    showTimer.current = window.setTimeout(() => {
      if (target.current !== el || !el.isConnected) return
      setPos(null)
      setHint({ text: el.innerText.trim(), rect: el.getBoundingClientRect() })
    }, SHOW_DELAY)
  }, [])

  useEffect(() => {
    const inHint = (node: EventTarget | null): boolean =>
      node instanceof Node && !!box.current?.contains(node)

    const onOver = (e: PointerEvent): void => {
      if (e.pointerType === 'touch' || inHint(e.target)) return
      const el = findClipped(e.target as Element)
      if (el) scheduleShow(el)
      else if (target.current && !target.current.contains(e.target as Node)) scheduleHide()
    }
    const onFocus = (e: FocusEvent): void => {
      if (inHint(e.target)) return
      const node = e.target as Element
      // Фокус обычно на ссылке, а обрезан вложенный текст.
      const el =
        findClipped(node) ?? findClipped(node.querySelector?.('.truncate, [class*="line-clamp-"]'))
      if (el) scheduleShow(el)
      else scheduleHide()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    const onDown = (e: PointerEvent): void => {
      if (!inHint(e.target)) hide()
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    // Текст уехал из-под подсказки — она уже не про то место.
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.clearTimeout(showTimer.current)
      window.clearTimeout(hideTimer.current)
    }
  }, [hide, scheduleHide, scheduleShow])

  // Место считаем по готовому размеру подсказки: под текстом, а не влезает — над ним;
  // по горизонтали — от начала текста, но не за краем окна.
  useLayoutEffect(() => {
    const el = box.current
    if (!hint || !el) return
    const { width, height } = el.getBoundingClientRect()
    const { rect } = hint
    const below = rect.bottom + GAP
    const top =
      below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, rect.top - GAP - height)
    const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE)
    setPos({ top, left })
  }, [hint])

  function copy(): void {
    if (!hint) return
    navigator.clipboard.writeText(hint.text).then(
      () => toast.success(t('copied')),
      () => toast.error(t('copyFailed')),
    )
  }

  if (!hint) return null
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      data-overflow-hint="off"
      onPointerEnter={() => window.clearTimeout(hideTimer.current)}
      onPointerLeave={scheduleHide}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="fixed z-[300] flex max-w-sm items-start gap-2 rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md animate-in fade-in-0 zoom-in-95"
    >
      <span className="break-words whitespace-pre-line select-text">{hint.text}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={t('copy')}
        className="shrink-0 cursor-pointer rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
      >
        <Copy className="size-3.5" aria-hidden />
      </button>
    </div>,
    document.body,
  )
}
