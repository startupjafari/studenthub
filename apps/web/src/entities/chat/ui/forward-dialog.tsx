'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Search, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button, Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { identityColor, identityInitials, useBodyScrollLock } from '../../../shared/lib'
import type { ChatListItem } from '../model/types'

// ── Визуал строки (Telegram-стиль) ───────────────────────────────────────────
// Аватар — цветной кружок с инициалами (картинок у чатов нет; как в сайдбаре).

// Диалог пересылки (Ф9+): множественный выбор целевых чатов с поиском.
// Подпись чата даёт вызывающий (titleOf). onPick вызывается по одному разу на каждый
// выбранный чат при подтверждении — контракт для вызывающих (по чату = одна мутация).
export function ForwardDialog({
  chats,
  currentChatId,
  titleOf,
  onPick,
  onClose,
}: {
  chats: ChatListItem[]
  currentChatId: string | null
  titleOf: (c: ChatListItem) => string
  onPick: (targetChatId: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  useBodyScrollLock()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const targets = useMemo(() => chats.filter((c) => c.id !== currentChatId), [chats, currentChatId])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return targets
    return targets.filter((c) => titleOf(c).toLowerCase().includes(q))
  }, [targets, query, titleOf])

  function subtitleOf(c: ChatListItem): string {
    return c.type === 'PRIVATE' ? t('typePrivate') : t('participants', { count: c.memberCount })
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit(): void {
    if (selected.size === 0) return
    selected.forEach((id) => onPick(id))
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="text-lg font-semibold">{t('forward')}…</span>
          <button
            type="button"
            aria-label={t('cancel')}
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="rounded-full pl-9"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-1">
          {targets.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t('noChats')}</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t('noResults')}</p>
          ) : (
            filtered.map((c) => {
              const isChecked = selected.has(c.id)
              const title = titleOf(c)
              return (
                <button
                  key={c.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  onClick={() => toggle(c.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/60',
                    isChecked && 'bg-primary/10 hover:bg-primary/15',
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar className="size-12">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={title} />}
                      <AvatarFallback
                        className={cn('text-sm font-medium text-white', identityColor(c.id))}
                      >
                        {identityInitials(title)}
                      </AvatarFallback>
                    </Avatar>
                    {isChecked && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
                        aria-hidden
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{title}</span>
                    <span className="truncate text-xs text-muted-foreground">{subtitleOf(c)}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          {selected.size > 0 && (
            <Button type="button" onClick={submit}>
              {t('send')} ({selected.size})
            </Button>
          )}
        </footer>
      </div>
    </div>
  )
}
