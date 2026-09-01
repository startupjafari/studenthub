'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import {
  Bold,
  Code,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react'
import { PromptDialog } from './prompt-dialog'
import { cn } from '../lib/utils'

/**
 * Поле форматированного текста: в поле сразу виден результат (жирный — жирным, без
 * `**`), а хранится и уезжает на сервер по-прежнему markdown.
 *
 * Почему WYSIWYG, а не подсветка разметки поверх textarea (как было): маркеры в поле
 * мешали понять, что именно отправится. Почему markdown, а не HTML: HTML, написанный
 * пользователем, пришлось бы санировать на каждом экране, где текст показывается —
 * поэтому `Markdown.html = false`, и всё, что редактор не умеет, в текст не попадает.
 *
 * Панель не висит над полем: она всплывает над выделением (`BubbleMenu`), а на пустой
 * строке — блочная панель (`FloatingMenu`, только там, где есть блочные действия:
 * заголовок, картинка, таблица). Работают и обычные горячие клавиши — Ctrl/Cmd+B и т. д.
 */

// tiptap-markdown кладёт свои методы в `editor.storage.markdown`, но о типах Tiptap не
// знает: без этого объявления `getMarkdown()` не виден компилятору.
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage
  }
}

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

/** Блочные действия: у них своя панель на пустой строке — выделять там нечего. */
const BLOCK_KEYS: readonly MarkdownActionKey[] = ['heading', 'bullet', 'ordered', 'quote', 'image', 'table'] // prettier-ignore

// Действия панели. `run` возвращает `'prompt'`, если действию нужен адрес (ссылка,
// картинка) — тогда поле открывает системный диалог ввода вместо window.prompt.
const ACTIONS: {
  key: MarkdownActionKey
  icon: typeof Bold
  run: (editor: Editor) => void | 'prompt'
  isActive: (editor: Editor) => boolean
}[] = [
  {
    key: 'bold',
    icon: Bold,
    run: (e) => void e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive('bold'),
  },
  {
    key: 'italic',
    icon: Italic,
    run: (e) => void e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive('italic'),
  },
  {
    key: 'strike',
    icon: Strikethrough,
    run: (e) => void e.chain().focus().toggleStrike().run(),
    isActive: (e) => e.isActive('strike'),
  },
  {
    key: 'code',
    icon: Code,
    run: (e) => void e.chain().focus().toggleCode().run(),
    isActive: (e) => e.isActive('code'),
  },
  {
    key: 'heading',
    icon: Heading2,
    run: (e) => void e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  { key: 'link', icon: Link2, run: () => 'prompt', isActive: (e) => e.isActive('link') },
  {
    key: 'bullet',
    icon: List,
    run: (e) => void e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    key: 'ordered',
    icon: ListOrdered,
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
  {
    key: 'quote',
    icon: Quote,
    run: (e) => void e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
  { key: 'image', icon: ImageIcon, run: () => 'prompt', isActive: () => false },
  {
    key: 'table',
    icon: TableIcon,
    run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    isActive: (e) => e.isActive('table'),
  },
]

/** Ряд кнопок панели. Одна строка всегда: перенос читался бы как две панели. */
function ActionRow({
  editor,
  actions,
  onAction,
}: {
  editor: Editor
  actions: readonly MarkdownActionKey[]
  onAction: (key: MarkdownActionKey) => void
}) {
  const t = useTranslations('Editor')
  const shown = actions.flatMap((key) => ACTIONS.filter((a) => a.key === key))
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-popover p-1 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {shown.map(({ key, icon: Icon, isActive }) => (
        <button
          key={key}
          type="button"
          aria-label={t(key)}
          title={t(key)}
          aria-pressed={isActive(editor)}
          // Нажатие не должно уводить фокус из поля: иначе выделение слетает и
          // форматировать становится нечего.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAction(key)}
          className={cn(
            // На тач-экране кнопка крупнее: 32px мимо пальца. `shrink-0` — в
            // прокручиваемом ряду кнопки не должны сжиматься в полоски.
            'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors sm:size-8',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            isActive(editor) ? 'bg-muted text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}

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

export function RichTextField({
  value,
  onChange,
  placeholder,
  actions = MARKDOWN_ACTIONS_TEXT,
  bare,
  className,
  wrapperClassName,
  id,
  'aria-label': ariaLabel,
  onKeyDown,
  handle,
}: RichTextFieldProps) {
  const t = useTranslations('Editor')
  // Диалог адреса: ссылка и картинка — единственные действия, которым нужен ввод.
  const [prompt, setPrompt] = useState<'link' | 'image' | null>(null)
  // Обработчик клавиш читаем через ref: `editorProps` фиксируется при создании редактора.
  const keyDownRef = useRef(onKeyDown)
  keyDownRef.current = onKeyDown
  // Последнее значение, которое поле само отдало наружу: с ним сверяем входящий `value`,
  // чтобы не пересобирать документ на каждое нажатие (курсор прыгал бы в конец).
  const emitted = useRef(value)

  const editor = useEditor({
    // SSR: Next.js рендерит страницу на сервере, где DOM нет — первый кадр рисуем в браузере.
    immediatelyRender: false,
    extensions: [
      // Узлы включены все, даже если кнопки для них нет: иначе правка сообщения или
      // статьи, где список уже есть, потеряла бы его при разборе markdown.
      StarterKit.configure({
        // Подчёркивания в markdown нет — оно уехало бы на сервер как HTML.
        underline: false,
        link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } },
      }),
      Image.configure({ inline: false }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      // html: false — сырой HTML из вставки не попадёт ни в документ, ни на сервер.
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn('min-w-0 px-3 py-2 text-sm leading-relaxed', className),
        ...(id ? { id } : {}),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handleKeyDown: (_view, event) =>
        // Во время набора через IME (китайский, японский, корейский) Enter подтверждает
        // выбор иероглифа — перехватывать его нельзя, иначе сообщение уйдёт недописанным.
        event.isComposing ? false : keyDownRef.current?.(event) === true,
    },
    onUpdate: ({ editor: ed }) => {
      const md = ed.storage.markdown.getMarkdown()
      emitted.current = md
      onChange(md)
    },
  })

  // Значение пришло снаружи (черновик чата, сброс после отправки, загрузка статьи) —
  // пересобираем документ. Своё же значение игнорируем: setContent сбрасывает курсор.
  useEffect(() => {
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(value)
  }, [editor, value])

  useEffect(() => {
    if (!editor || !handle) return
    handle.current = {
      focus: () => void editor.commands.focus('end'),
      insertText: (text, deleteBefore = 0) => {
        const to = editor.state.selection.from
        const from = Math.max(1, to - deleteBefore)
        // Текстовый узел, а не строка: строку редактор разобрал бы как markdown, и
        // имя со звёздочкой превратилось бы в разметку.
        editor.chain().focus().insertContentAt({ from, to }, { type: 'text', text }).run()
      },
      textBefore: () => editor.state.doc.textBetween(0, editor.state.selection.from, '\n', '\n'),
    }
    return () => {
      handle.current = null
    }
  }, [editor, handle])

  function apply(key: MarkdownActionKey): void {
    if (!editor) return
    const action = ACTIONS.find((a) => a.key === key)
    if (!action) return
    if (action.run(editor) === 'prompt') setPrompt(key === 'image' ? 'image' : 'link')
  }

  function submitPrompt(url: string): void {
    const href = url.trim()
    setPrompt(null)
    if (!editor || !href) return
    if (prompt === 'image') {
      editor.chain().focus().setImage({ src: href }).run()
      return
    }
    const { from, to } = editor.state.selection
    if (from === to) {
      // Выделения нет — вставляем сам адрес и делаем его ссылкой: иначе метка легла бы
      // на пустое место и в тексте не появилось бы ничего.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  const blockActions = actions.filter((key) => BLOCK_KEYS.includes(key))
  // Блочная панель нужна там, где есть что вставить в пустую строку (картинка, таблица):
  // выделения на пустой строке нет, а значит и всплывающей панели над ним тоже.
  const showBlockMenu = blockActions.some((key) => key === 'image' || key === 'table')

  return (
    <div
      className={cn(
        'rte flex min-w-0 flex-col',
        !bare &&
          'rounded-xl border border-input transition-[color,box-shadow,border-color] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15 hover:border-ring/50',
        wrapperClassName,
      )}
    >
      {editor && (
        <>
          {/* Панель над выделением. Позицию (и переворот, когда сверху нет места)
              считает Floating UI внутри BubbleMenu. */}
          <BubbleMenu
            editor={editor}
            options={{ placement: 'top', offset: 8 }}
            shouldShow={({ from, to }) => from !== to}
          >
            <ActionRow editor={editor} actions={actions} onAction={apply} />
          </BubbleMenu>

          {showBlockMenu && (
            <FloatingMenu editor={editor} options={{ placement: 'bottom-start', offset: 8 }}>
              <ActionRow editor={editor} actions={blockActions} onAction={apply} />
            </FloatingMenu>
          )}
        </>
      )}

      <EditorContent editor={editor} className="flex min-h-0 min-w-0 flex-col" />

      <PromptDialog
        open={prompt !== null}
        title={prompt === 'image' ? t('imageUrl') : t('linkUrl')}
        placeholder="https://"
        required
        submitLabel={t('insert')}
        cancelLabel={t('cancel')}
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
    </div>
  )
}
