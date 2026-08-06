'use client'

import { cn } from '../../../shared/lib/utils'
import type { MessageReaction } from '../model/types'

function reactorName(u: MessageReaction['user']): string {
  return `${u.lastName} ${u.firstName}`.trim()
}

// Реакции-эмодзи под сообщением (Ф9+): агрегированные чипы со счётчиком.
// Клик по чипу — тоггл своей реакции; в подсказке (title) — кто поставил (как в Telegram).
// Добавление новых реакций — через контекстное меню сообщения (быстрый ряд эмодзи).
export function ReactionBar({
  reactions,
  myId,
  onToggle,
}: {
  reactions: MessageReaction[]
  myId: string | undefined
  onToggle: (emoji: string) => void
}) {
  if (reactions.length === 0) return null

  const grouped = new Map<string, { count: number; mine: boolean; names: string[] }>()
  for (const r of reactions) {
    const cur = grouped.get(r.emoji) ?? { count: 0, mine: false, names: [] }
    cur.count += 1
    cur.names.push(reactorName(r.user))
    if (r.userId === myId) cur.mine = true
    grouped.set(r.emoji, cur)
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {[...grouped.entries()].map(([emoji, { count, mine, names }]) => (
        <button
          key={emoji}
          type="button"
          title={names.join(', ')}
          onClick={() => onToggle(emoji)}
          className={cn(
            'flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
            mine
              ? 'border-primary/60 bg-primary/15 text-foreground'
              : 'border-border bg-background/60 hover:bg-muted',
          )}
        >
          <span>{emoji}</span>
          <span className="tabular-nums">{count}</span>
        </button>
      ))}
    </div>
  )
}
