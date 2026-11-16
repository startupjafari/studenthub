import type { RefObject } from 'react'

// Наборы кнопок и типы поля форматированного текста — отдельно от самого редактора
// (rich-text-editor.tsx): их импортируют формы, которым не нужен tiptap в бандле.

export type MarkdownActionKey =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'heading'
  | 'link'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'image'
  | 'table'

/** Набор кнопок по умолчанию: пост и комментарий — строчная разметка и списки. */
export const MARKDOWN_ACTIONS_TEXT: readonly MarkdownActionKey[] = [
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'bullet',
  'ordered',
  'quote',
]

/** Полный набор: статья — там уместны заголовки, картинки и таблицы. */
export const MARKDOWN_ACTIONS_ARTICLE: readonly MarkdownActionKey[] = [
  'bold',
  'italic',
  'heading',
  'link',
  'code',
  'bullet',
  'ordered',
  'quote',
  'image',
  'table',
]

/** Только строчная разметка: поле чата — короткое сообщение, без блоков. */
export const MARKDOWN_ACTIONS_INLINE: readonly MarkdownActionKey[] = [
  'bold',
  'italic',
  'strike',
  'code',
  'link',
]

/** Императивный доступ к полю: чату нужны фокус, вставка emoji и текст перед курсором. */
export interface RichTextHandle {
  focus: () => void
  /** Вставить текст, при необходимости стерев `deleteBefore` символов перед курсором. */
  insertText: (text: string, deleteBefore?: number) => void
  /** Текст от начала до курсора — по нему чат ищет `@запрос` для автодополнения. */
  textBefore: () => string
}

export interface RichTextFieldProps {
  /** Значение в markdown. */
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  /** Какие кнопки в панели: `MARKDOWN_ACTIONS_TEXT` (по умолчанию), `..._ARTICLE`, `..._INLINE`. */
  actions?: readonly MarkdownActionKey[]
  /** Без собственной рамки: когда поле стоит внутри общей рамки блока. */
  bare?: boolean
  /** Классы области ввода — высота и прокрутка (`min-h-28 max-h-[45vh]`). */
  className?: string
  /** Классы обёртки — например `min-w-0 flex-1` в строке контролов. */
  wrapperClassName?: string
  id?: string
  'aria-label'?: string
  /**
   * Перехват клавиш до редактора: вернуть `true`, если обработали сами (Enter отправляет
   * сообщение, Escape закрывает попап упоминаний).
   */
  onKeyDown?: (event: KeyboardEvent) => boolean
  handle?: RefObject<RichTextHandle | null>
}
