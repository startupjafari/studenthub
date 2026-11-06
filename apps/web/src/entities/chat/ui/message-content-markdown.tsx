'use client'

import { Children, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MessageContentMath } from './message-content-math'
import { MarkdownImage } from '../../../shared/ui'
import { MD_CLASS } from './message-content-style'

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
  // Внешняя картинка из сообщения — трекинг-пиксель для каждого участника чата.
  img: MarkdownImage,
}

// Грубая эвристика наличия формулы: $…$ или $$…$$ (не одиночный «$5»).
const MATH_RE = /\$\$?[^$\n]+\$\$?/

export function MessageContentMarkdown({
  content,
  highlight,
}: {
  content: string
  highlight?: string
}) {
  const hasMath = content ? MATH_RE.test(content) : false
  const [MathRenderer, setMathRenderer] = useState<typeof MessageContentMath | null>(null)

  useEffect(() => {
    if (hasMath && !MathRenderer) {
      void import('./message-content-math').then((m) => setMathRenderer(() => m.MessageContentMath))
    }
  }, [hasMath, MathRenderer])

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
      td: ({ node: _n, children, ...props }) => (
        <td {...props}>{highlightChildren(children, highlight)}</td>
      ),
    }
  }, [highlight])

  if (!content) return null
  return (
    <div className={MD_CLASS}>
      {hasMath && MathRenderer ? (
        // Формула есть и рендерер загружен — рисуем с katex.
        <MathRenderer content={content} components={components} />
      ) : (
        // Обычный путь (нет формул) + короткий момент загрузки math-рендерера: gfm без katex.
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      )}
    </div>
  )
}
