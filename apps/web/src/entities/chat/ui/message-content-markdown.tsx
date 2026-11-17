'use client'

import { Children, createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslations } from 'next-intl'
import { applyChatMarks, type MdNode } from '../lib/remark-chat-marks'
import { MD_CLASS } from './message-content-style'

/**
 * Контракт разметки сообщения (PROJECT.md §3.6 «Разметка сообщения чата») — набор Telegram:
 * жирный, курсив, подчёркнутый, зачёркнутый, моно, спойлер, ссылка, цитата, блок кода, списки.
 * Подчёркнутый `++…++` и спойлер `||…||` разбираются поверх CommonMark (`applyChatMarks`). Его же рисуют iOS и
 * Android; всё, что сверх него, веб показывает исходным текстом, иначе одно сообщение выглядело
 * бы по-разному у собеседников на разных клиентах.
 *
 * Лишние конструкции выключаем при РАЗБОРЕ, а не прячем при отрисовке: выключенная конструкция
 * остаётся буквами как написана (`# заголовок`, `| a | b |`). Скрытие тега (`unwrapDisallowed`)
 * съело бы `#` и черту таблицы и склеило бы ячейки в кашу.
 */
const OFF_CONSTRUCTS = [
  'headingAtx', // # заголовок
  'setextUnderline', // заголовок подчёркиванием === / ---
  'thematicBreak', // горизонтальная линия
  'codeIndented', // код отступом: в чате отступ — это просто отступ, код — только ```
  'htmlFlow',
  'htmlText',
  'definition', // [a]: url — строка иначе исчезает целиком
  'table', // gfm
  'gfmFootnoteDefinition',
  'gfmFootnoteCall',
  'gfmPotentialFootnoteCall',
  'tasklistCheck', // - [ ] чекбокс
]

// Что вообще может дойти до DOM. Страховка поверх OFF_CONSTRUCTS: если очередная версия gfm
// принесёт новую конструкцию, её тег развернётся в текст, а не нарисуется.
const ALLOWED_ELEMENTS = [
  'p',
  'br',
  'strong',
  'em',
  'u', // ++подчёркнутый++
  'span', // ||спойлер|| — других span разбор не даёт: сырой HTML выключен
  'del',
  'code',
  'pre',
  'a',
  'blockquote',
  'ul',
  'ol',
  'li',
]

/**
 * Картинку `![подпись](url)` возвращаем исходным текстом. Выключить её при разборе нельзя:
 * без `![` остаток `[подпись](url)` стал бы ссылкой — другой конструкцией, а не текстом.
 * Заодно внешняя картинка в сообщении — трекинг-пиксель для каждого участника чата.
 */
function imagesToText(node: MdNode, source: string) {
  node.children?.forEach((child, i, list) => {
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (child.type === 'image' && start !== undefined && end !== undefined) {
      list[i] = { type: 'text', value: source.slice(start, end), position: child.position }
    } else {
      imagesToText(child, source)
    }
  })
}

function remarkChatContract(this: { data(): object }) {
  const data = this.data() as { micromarkExtensions?: object[] }
  ;(data.micromarkExtensions ??= []).push({ disable: { null: OFF_CONSTRUCTS } })
  return (tree: MdNode, file: { value: unknown }) => {
    const source = String(file.value)
    imagesToText(tree, source)
    applyChatMarks(tree, source)
  }
}

const REMARK_PLUGINS = [remarkGfm, remarkChatContract]

// Подсветка совпадений поиска (§3): режем строковые дети по вхождению term (без регистра) и
// оборачиваем в <mark>. Нестроковые дети (вложенный markdown) пропускаем как есть — не ломаем разметку.
function highlightText(text: string, term: string): ReactNode {
  const out: ReactNode[] = []
  const lower = text.toLowerCase()
  const tl = term.toLowerCase()
  let i = 0
  let idx = lower.indexOf(tl)
  let k = 0
  while (idx !== -1) {
    if (idx > i) out.push(text.slice(i, idx))
    out.push(
      <mark key={k++} className="rounded bg-warning/30 px-0.5 text-inherit dark:bg-warning/40">
        {text.slice(idx, idx + term.length)}
      </mark>,
    )
    i = idx + term.length
    idx = lower.indexOf(tl, i)
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}

function highlightChildren(children: ReactNode, term: string): ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string' ? highlightText(child, term) : child,
  )
}

/**
 * Спойлеры сообщения открываются вместе, одним касанием — как в Telegram: состояние на всё
 * сообщение, а не на каждый спойлер.
 */
const SpoilerContext = createContext<{ revealed: boolean; reveal: () => void }>({
  revealed: true,
  reveal: () => {},
})

/**
 * Спойлер `||…||`: до касания текст прозрачен, поверх — мерцающие точки (`.message-spoiler`
 * в globals.css, без анимации при prefers-reduced-motion). Скрытый спойлер — кнопка: Enter и
 * пробел открывают его так же, как щелчок, а скринридер не читает текст до открытия.
 * Щелчок не уходит выше — ни в ссылку внутри спойлера, ни в пузырь (выбор, меню).
 */
function Spoiler({ children }: { children?: ReactNode }) {
  const { revealed, reveal } = useContext(SpoilerContext)
  const t = useTranslations('Chats')
  if (revealed) {
    return (
      <span className="message-spoiler">
        <span className="message-spoiler-text">{children}</span>
      </span>
    )
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t('tgMarkup.spoiler')}
      data-hidden=""
      className="message-spoiler"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        reveal()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        reveal()
      }}
    >
      <span className="message-spoiler-text" aria-hidden>
        {children}
      </span>
    </span>
  )
}

/** Спойлер — единственный span, который даёт разбор (сырой HTML выключен). */
function isSpoilerNode(node: unknown): boolean {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties
  return properties !== undefined && 'dataSpoiler' in properties
}

const MD_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  /**
   * Жёсткий перенос не рисуем тегом — он и так виден.
   *
   * У абзаца стоит `whitespace-pre-wrap` (без него одиночные переводы строки в сообщении
   * схлопывались бы в пробел). react-markdown на жёсткий перенос отдаёт `<br>` И сам
   * символ перевода строки следом — под pre-wrap это два разрыва подряд, то есть пустая
   * строка между строками сообщения. Перевод строки после `<br>` есть всегда (так устроен
   * жёсткий перенос в markdown), поэтому гасим тег, а не символ.
   */
  br: () => null,
  span: ({ node, children }) =>
    isSpoilerNode(node) ? <Spoiler>{children}</Spoiler> : <span>{children}</span>,
}

export function MessageContentMarkdown({
  content,
  highlight,
}: {
  content: string
  highlight?: string
}) {
  // При активной подсветке поиска оборачиваем строковые дети текстовых узлов в <mark>.
  const components = useMemo<Components>(() => {
    if (!highlight) return MD_COMPONENTS
    return {
      ...MD_COMPONENTS,
      p: ({ node: _n, children, ...props }) => (
        <p {...props}>{highlightChildren(children, highlight)}</p>
      ),
      li: ({ node: _n, children, ...props }) => (
        <li {...props}>{highlightChildren(children, highlight)}</li>
      ),
      u: ({ node: _n, children, ...props }) => (
        <u {...props}>{highlightChildren(children, highlight)}</u>
      ),
      span: ({ node, children }) =>
        isSpoilerNode(node) ? (
          <Spoiler>{highlightChildren(children, highlight)}</Spoiler>
        ) : (
          <span>{highlightChildren(children, highlight)}</span>
        ),
    }
  }, [highlight])
  const [revealed, setRevealed] = useState(false)
  const spoilers = useMemo(() => ({ revealed, reveal: () => setRevealed(true) }), [revealed])

  if (!content) return null
  return (
    <SpoilerContext.Provider value={spoilers}>
      <div className={MD_CLASS}>
        {/* Формулы `$…$` вне контракта — остаются текстом, katex чату не нужен. */}
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          allowedElements={ALLOWED_ELEMENTS}
          unwrapDisallowed
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </SpoilerContext.Provider>
  )
}
