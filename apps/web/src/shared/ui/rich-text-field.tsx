'use client'

import { lazy, Suspense } from 'react'
import { cn } from '../lib/utils'
import type { RichTextFieldProps } from './rich-text-actions'

export {
  MARKDOWN_ACTIONS_ARTICLE,
  MARKDOWN_ACTIONS_INLINE,
  MARKDOWN_ACTIONS_TEXT,
  type MarkdownActionKey,
  type RichTextFieldProps,
  type RichTextHandle,
} from './rich-text-actions'

// Сам редактор (tiptap + prosemirror + markdown, ~550 КБ до сжатия) — отдельным чанком
// (задача 21.B4). Поле стоит в окне правки поста на каждой карточке ленты и в поле ввода
// чата, и статический импорт отдавал весь редактор главной и списку чатов до первой
// отрисовки. Редактор и раньше появлялся только в браузере (`immediatelyRender: false`):
// до готовности поле — пустая рамка, ровно её и рисует заглушка, только уже с высотой
// области ввода. `handle` наполняется, когда редактор готов, — как и раньше.
const RichTextEditor = lazy(() =>
  import('./rich-text-editor').then((m) => ({ default: m.RichTextEditor })),
)

export function RichTextField(props: RichTextFieldProps) {
  return (
    <Suspense fallback={<RichTextFieldPlaceholder {...props} />}>
      <RichTextEditor {...props} />
    </Suspense>
  )
}

function RichTextFieldPlaceholder({ bare, className, wrapperClassName }: RichTextFieldProps) {
  return (
    <div
      className={cn(
        'rte flex min-w-0 flex-col',
        !bare && 'rounded-xl border border-input',
        wrapperClassName,
      )}
    >
      <div className={cn('min-w-0 px-3 py-2 text-sm leading-relaxed', className)} />
    </div>
  )
}
