'use client'

import { useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { Textarea } from './textarea'
import { cn } from '../lib/utils'

/**
 * Поле текста с панелью форматирования (ограниченный markdown).
 *
 * Панель не прячет разметку: в поле остаётся `**жирный**`, и человек видит, что
 * именно уедет на сервер. Полноценный WYSIWYG потребовал бы редактора документа
 * и хранения HTML — с пользовательским HTML пришлось бы защищаться от XSS на
 * каждом экране, где текст показывается.
 */

type Wrap = { before: string; after?: string; block?: false }
type Prefix = { before: string; block: true }
type Action = Wrap | Prefix

const ACTIONS: { key: string; icon: typeof Bold; action: Action }[] = [
  { key: 'bold', icon: Bold, action: { before: '**', after: '**' } },
  { key: 'italic', icon: Italic, action: { before: '*', after: '*' } },
  { key: 'strike', icon: Strikethrough, action: { before: '~~', after: '~~' } },
  { key: 'code', icon: Code, action: { before: '`', after: '`' } },
  { key: 'link', icon: Link2, action: { before: '[', after: '](https://)' } },
  { key: 'bullet', icon: List, action: { before: '- ', block: true } },
  { key: 'ordered', icon: ListOrdered, action: { before: '1. ', block: true } },
  { key: 'quote', icon: Quote, action: { before: '> ', block: true } },
]

export function MarkdownEditor({
  value,
  onChange,
  id,
  rows = 5,
  placeholder,
  hint,
}: {
  value: string
  onChange: (next: string) => void
  id?: string
  rows?: number
  placeholder?: string
  /** Подсказка под полем — например «Поддерживается **жирный** и *курсив*». */
  hint?: ReactNode
}) {
  const t = useTranslations('Editor')
  const ref = useRef<HTMLTextAreaElement>(null)

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
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-0.5 rounded-xl border border-input bg-muted/30 p-1">
        {ACTIONS.map(({ key, icon: Icon, action }) => (
          <button
            key={key}
            type="button"
            aria-label={t(key)}
            title={t(key)}
            onClick={() => apply(action)}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors',
              'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        ))}
      </div>
      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
