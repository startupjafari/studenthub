'use client'

import { lazy, Suspense } from 'react'
import { MD_CLASS } from './message-content-style'

// Разбор markdown (react-markdown + remark-gfm, ~135 КБ до сжатия) — отдельным чанком
// (задача 21.B4). Список чатов, особенно на телефоне, не показывает ни одного сообщения,
// а статический импорт клал разборщик в бандл /chats до первой отрисовки. Пока чанк
// грузится (один раз — на первое открытое сообщение), текст стоит как есть в том же
// абзаце с pre-wrap: у обычного сообщения без разметки вид не меняется вовсе.
const MessageContentMarkdown = lazy(() =>
  import('./message-content-markdown').then((m) => ({ default: m.MessageContentMarkdown })),
)

export function MessageContent({ content, highlight }: { content: string; highlight?: string }) {
  if (!content) return null
  return (
    <Suspense
      fallback={
        <div className={MD_CLASS}>
          <p>{content}</p>
        </div>
      }
    >
      <MessageContentMarkdown content={content} highlight={highlight} />
    </Suspense>
  )
}
