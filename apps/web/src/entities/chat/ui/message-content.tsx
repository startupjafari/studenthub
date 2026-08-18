'use client'

import { Children, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../../../shared/lib/utils'
import type { MessageContentMath } from './message-content-math'

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
      <mark
        key={k++}
        className="rounded bg-yellow-300/70 px-0.5 text-inherit dark:bg-yellow-500/40"
      >
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

// Рендер текста сообщения как Markdown + формулы LaTeX ($...$ / $$...$$) для технических предметов
// (Ф9+). react-markdown не рендерит сырой HTML — XSS-безопасно. GFM даёт таблицы/код/списки.
// katex + math-плагины вынесены в ленивый message-content-math (грузятся только при наличии
// формулы) — базовый бандл чата не тащит katex, хотя формулы есть в единичных сообщениях.
const MD_CLASS = cn(
  'message-md text-sm leading-relaxed break-words',
  '[&_p]:whitespace-pre-wrap [&_p]:m-0',
  '[&_p+p]:mt-2 [&_ul]:my-1 [&_ol]:my-1 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:list-disc [&_ol>li]:list-decimal',
  '[&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-mono',
  '[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/80 [&_pre]:p-2.5 [&_pre]:text-xs [&_pre]:text-white',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-white',
  '[&_table]:my-1.5 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-current/30 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-current/20 [&_td]:px-2 [&_td]:py-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-current/40 [&_blockquote]:pl-2 [&_blockquote]:opacity-90',
)

const MD_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

// Грубая эвристика наличия формулы: $…$ или $$…$$ (не одиночный «$5»).
const MATH_RE = /\$\$?[^$\n]+\$\$?/

export function MessageContent({ content, highlight }: { content: string; highlight?: string }) {
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
