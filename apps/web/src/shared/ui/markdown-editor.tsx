'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { highlightMarkdown } from './markdown'
import { cn } from '../lib/utils'

/**
 * Поле текста с панелью форматирования (ограниченный markdown).
 *
 * Панель не прячет разметку: в поле остаётся `**жирный**`, и человек видит, что
 * именно уедет на сервер. Полноценный WYSIWYG потребовал бы редактора документа
 * и хранения HTML — с пользовательским HTML пришлось бы защищаться от XSS на
 * каждом экране, где текст показывается.
 *
 * Панель не висит над полем постоянно, а всплывает над выделением: в компактном
 * окне публикации ряд кнопок отъедал высоту у самого текста, ради которого окно и
 * открывают.
 */

type Wrap = { before: string; after?: string; block?: false }
type Prefix = { before: string; block: true }
type Action = Wrap | Prefix

/**
 * Классы, общие для поля и его подсветки. Держим одной строкой: разъедутся отступы
 * или интерлиньяж — разъедется и подсветка.
 */
const SHARED =
  'w-full min-w-0 rounded-xl border px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words'

export type MarkdownActionKey =
  'bold' | 'italic' | 'strike' | 'code' | 'link' | 'bullet' | 'ordered' | 'quote'

const ACTIONS: { key: MarkdownActionKey; icon: typeof Bold; action: Action }[] = [
  { key: 'bold', icon: Bold, action: { before: '**', after: '**' } },
  { key: 'italic', icon: Italic, action: { before: '*', after: '*' } },
  { key: 'strike', icon: Strikethrough, action: { before: '~~', after: '~~' } },
  { key: 'code', icon: Code, action: { before: '`', after: '`' } },
  { key: 'link', icon: Link2, action: { before: '[', after: '](https://)' } },
  { key: 'bullet', icon: List, action: { before: '- ', block: true } },
  { key: 'ordered', icon: ListOrdered, action: { before: '1. ', block: true } },
  { key: 'quote', icon: Quote, action: { before: '> ', block: true } },
]

// Ряд кнопок форматирования во всплывающей панели.
function MarkdownToolbar({
  onAction,
  className,
}: {
  onAction: (key: MarkdownActionKey) => void
  className?: string
}) {
  const t = useTranslations('Editor')
  return (
    <div className={cn('flex flex-wrap items-center gap-0.5', className)}>
      {ACTIONS.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-label={t(key)}
          title={t(key)}
          // Нажатие не должно уводить фокус из поля: иначе выделение слетает и
          // форматировать становится нечего (и всплывающая панель исчезает).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAction(key)}
          className={cn(
            // На тач-экране кнопка крупнее: 32px мимо пальца. Все восемь при этом
            // остаются в одну строку на 375px — второй ряд съел бы высоту поля.
            'flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors sm:size-8',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}

export interface MarkdownEditorProps {
  value: string
  onChange: (next: string) => void
  id?: string
  rows?: number
  placeholder?: string
  /** Поле растёт под текст вместо внутренней прокрутки (ограничение — `className`). */
  autoGrow?: boolean
  /** Без собственной рамки: когда поле стоит внутри общей рамки блока. */
  bare?: boolean
  /** Классы поля — например ограничение роста `max-h-[45vh]`. */
  className?: string
  'aria-label'?: string
}

// Панель всплывает над строкой с выделением; если строка у самого верха поля —
// уходит под неё. Высота панели + зазор, чтобы понять, помещается ли она сверху.
const FLOAT_OFFSET = 48

export function MarkdownEditor({
  value,
  onChange,
  id,
  rows = 5,
  placeholder,
  autoGrow,
  bare,
  className,
  'aria-label': ariaLabel,
}: MarkdownEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const lines = highlightMarkdown(value)

  // Положение всплывающей панели относительно поля (null — выделения нет).
  const [float, setFloat] = useState<{ top: number; below: boolean } | null>(null)

  // Геометрию берём у слоя подсветки: он посимвольно совпадает с полем, а каждая
  // логическая строка — отдельный div, поэтому перенос длинной строки уже учтён.
  function syncFloating(): void {
    const el = ref.current
    const mirror = mirrorRef.current
    const box = boxRef.current
    if (!el || !mirror || !box) return
    const { selectionStart: start, selectionEnd: end } = el
    if (start === end) {
      setFloat(null)
      return
    }
    const lineIndex = el.value.slice(0, Math.min(start, end)).split('\n').length - 1
    const lineEl = mirror.children[lineIndex] as HTMLElement | undefined
    if (!lineEl) {
      setFloat(null)
      return
    }
    const lineRect = lineEl.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const top = lineRect.top - boxRect.top
    // Выделение уехало прокруткой за пределы поля — панели там делать нечего.
    if (lineRect.bottom < boxRect.top || lineRect.top > boxRect.bottom) {
      setFloat(null)
      return
    }
    const below = top < FLOAT_OFFSET
    setFloat({ top: below ? lineRect.bottom - boxRect.top : top, below })
  }

  function apply(action: Action): void {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length

    if (action.block) {
      // Списки и цитата — префикс к каждой строке выделения (или к текущей).
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const lineEnd = value.indexOf('\n', end)
      const stop = lineEnd === -1 ? value.length : lineEnd
      const chunk = value.slice(lineStart, stop)
      const next =
        value.slice(0, lineStart) +
        chunk
          .split('\n')
          .map((l) => action.before + l)
          .join('\n') +
        value.slice(stop)
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        const pos = stop + action.before.length
        el.setSelectionRange(pos, pos)
        syncFloating()
      })
      return
    }

    const after = action.after ?? ''
    const selected = value.slice(start, end)
    const next = value.slice(0, start) + action.before + selected + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      // Пустое выделение — курсор между маркерами, чтобы можно было сразу печатать.
      const from = start + action.before.length
      el.setSelectionRange(from, from + selected.length)
      syncFloating()
    })
  }

  function applyKey(key: MarkdownActionKey): void {
    const found = ACTIONS.find((a) => a.key === key)
    if (found) apply(found.action)
  }

  // Рост под текст: сначала сбрасываем высоту, иначе поле умеет только расти.
  // Разница offsetHeight/clientHeight — рамки: scrollHeight их не считает, а
  // border-box требует их в height, иначе поле недосчитывается пары пикселей.
  useLayoutEffect(() => {
    if (!autoGrow) return
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const borders = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + borders}px`
  }, [value, autoGrow])

  return (
    <div className="flex min-w-0 flex-col">
      {/* Живая подсветка: под прозрачным текстом поля лежит его точная копия с
        оформлением. Так жирный виден жирным прямо во время набора, но редактирование,
        выделение, отмена и мобильная клавиатура остаются нативными — contenteditable
        пришлось бы чинить всё это руками.

        Слои обязаны совпадать посимвольно: одинаковые шрифт, кегль, интерлиньяж,
        отступы и перенос. Любое расхождение — и подсветка «уезжает» от текста. */}
      <div ref={boxRef} className="relative">
        <div
          ref={mirrorRef}
          // Метка для правила «на тач-устройствах шрифт полей 16px» (globals.css):
          // копия обязана менять кегль вместе с полем, иначе слои разъедутся.
          data-md-mirror
          aria-hidden
          className={cn(SHARED, 'pointer-events-none absolute inset-0 overflow-hidden border-transparent', className)} // prettier-ignore
        >
          {lines.map((tokens, i) => (
            <div key={i}>
              {tokens.length === 0 ? (
                // Пустая строка всё равно должна занимать высоту строки.
                <br />
              ) : (
                tokens.map((tk, j) => (
                  <span
                    key={j}
                    className={cn(tk.marker ? 'text-muted-foreground/40' : tk.className)}
                  >
                    {tk.text}
                  </span>
                ))
              )}
            </div>
          ))}
        </div>

        <textarea
          ref={ref}
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck
          onChange={(e) => onChange(e.target.value)}
          onSelect={syncFloating}
          onBlur={() => setFloat(null)}
          onScroll={(e) => {
            // Подсветка не прокручивается сама — её ведёт поле.
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
            syncFloating()
          }}
          className={cn(
            SHARED,
            'relative resize-none bg-transparent text-transparent caret-foreground',
            // Полосу прокрутки прячем не ради красоты: она съедает ширину контента
            // у поля, но не у слоя подсветки (тот `overflow-hidden`), строки начинают
            // переноситься в разных местах — и подсветка уезжает от текста тем сильнее,
            // чем длиннее пост. Прокрутка колесом, клавишами и пальцем остаётся.
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'border-input transition-[color,box-shadow,border-color] outline-none',
            'placeholder:text-muted-foreground/70',
            bare
              ? // Рамку и фокус рисует общий блок вокруг заголовка и текста.
                'border-transparent'
              : 'hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15',
            className,
          )}
        />

        {float && (
          <div
            // Панель перекрывает текст, поэтому появляется только пока есть выделение.
            style={{ top: float.top }}
            className={cn(
              'absolute left-1/2 z-10 flex -translate-x-1/2 rounded-xl border border-border bg-popover p-1 shadow-lg',
              float.below ? 'mt-2' : '-mt-2 -translate-y-full',
            )}
          >
            <MarkdownToolbar onAction={applyKey} />
          </div>
        )}
      </div>
    </div>
  )
}
