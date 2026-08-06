'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { cn } from '../../../shared/lib/utils'

// Рендер текста сообщения как Markdown + формулы LaTeX ($...$ / $$...$$) для технических предметов
// (Ф9+). react-markdown не рендерит сырой HTML — XSS-безопасно. GFM даёт таблицы/код/списки.
// Стили компактные, наследуют цвет пузыря (для своих сообщений — на тёмном фоне).
export function MessageContent({ content }: { content: string }) {
  if (!content) return null
  return (
    <div
      className={cn(
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
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
