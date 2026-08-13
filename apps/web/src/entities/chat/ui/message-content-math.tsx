'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// Ленивый рендер Markdown + формул LaTeX. Импортируется динамически (см. message-content.tsx)
// ТОЛЬКО для сообщений, где реально есть формула — тяжёлый katex (+ CSS/шрифты) и math-плагины
// не попадают в базовый бандл чата, который грузится на каждом сообщении.
export function MessageContentMath({
  content,
  components,
}: {
  content: string
  components: Components
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
}
