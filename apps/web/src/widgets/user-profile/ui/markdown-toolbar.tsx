'use client'

import type { RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  Bold,
  Code,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  Quote,
  Table,
} from 'lucide-react'

interface MarkdownToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
}

// Панель форматирования: вставляет markdown вокруг выделения. Рендер — react-markdown.
export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const t = useTranslations('Profile')
  function surround(before: string, after = before, placeholder = '') {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const sel = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + sel + after + value.slice(end)
    onChange(next)
    queueMicrotask(() => {
      ta.focus()
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + sel.length
    })
  }

  function prefixLine(prefix: string, placeholder: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const sel = value.slice(lineStart, ta.selectionEnd) || placeholder
    const next = value.slice(0, lineStart) + prefix + sel + value.slice(ta.selectionEnd)
    onChange(next)
    queueMicrotask(() => {
      ta.focus()
      ta.selectionStart = lineStart + prefix.length
      ta.selectionEnd = lineStart + prefix.length + sel.length
    })
  }

  function insert(text: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const next = value.slice(0, start) + text + value.slice(ta.selectionEnd)
    onChange(next)
    queueMicrotask(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + text.length
    })
  }

  const btn =
    'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

  const col = t('mdTableCol')
  const cell = t('mdTableCell')

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-1">
      <button type="button" className={btn} title={t('mdBold')} onClick={() => surround('**')}>
        <Bold className="size-4" aria-hidden />
      </button>
      <button type="button" className={btn} title={t('mdItalic')} onClick={() => surround('_')}>
        <Italic className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        title={t('mdHeading')}
        onClick={() => prefixLine('## ', '')}
      >
        <Heading2 className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        title={t('mdList')}
        onClick={() => prefixLine('- ', '')}
      >
        <List className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        title={t('mdQuote')}
        onClick={() => prefixLine('> ', '')}
      >
        <Quote className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        title={t('mdLink')}
        onClick={() => surround('[', '](https://)', t('mdLinkText'))}
      >
        <Link2 className="size-4" aria-hidden />
      </button>
      <button type="button" className={btn} title={t('mdCode')} onClick={() => surround('`')}>
        <Code className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        title={t('mdImage')}
        onClick={() => insert('![](https://)')}
      >
        <ImageIcon className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        title={t('mdTable')}
        onClick={() => insert(`\n| ${col} | ${col} |\n| --- | --- |\n| ${cell} | ${cell} |\n`)}
      >
        <Table className="size-4" aria-hidden />
      </button>
    </div>
  )
}
