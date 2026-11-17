'use client'

import { useTranslations } from 'next-intl'
import { PanelLeftOpen } from 'lucide-react'
import type { ChatListItem } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { LIST_MAX_W, type ChatListWidth } from '../lib/use-list-width'
import { avatarColor, chatInitials, chatTitle } from '../lib/format'

/**
 * Свёрнутая колонка списка чатов (ПК): только аватары со счётчиками, имя — в подсказке.
 * Наверху — «развернуть»; развернуть можно и оттянув край колонки обратно.
 */
export function ChatListRail({
  chats,
  activeId,
  onOpenChat,
  onExpand,
}: {
  chats: ChatListItem[]
  activeId: string | null
  onOpenChat: (id: string) => void
  onExpand: () => void
}) {
  const t = useTranslations('Chats')
  const tNav = useTranslations('Nav')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Высота как у шапки развёрнутого списка (py-3 вокруг 40-px кнопки): линия под
          шапками колонки и переписки не ломается при сворачивании. */}
      <div className="flex shrink-0 justify-center border-b border-border py-3">
        <button
          type="button"
          onClick={onExpand}
          aria-label={t('tgShell.expandList')}
          title={t('tgShell.expandList')}
          className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
        >
          <PanelLeftOpen className="size-5" aria-hidden />
        </button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overscroll-contain py-2">
        {chats.map((c) => {
          const title = chatTitle(c, t)
          const unread = c.unreadCount > 0
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpenChat(c.id)}
                aria-current={c.id === activeId ? 'true' : undefined}
                aria-label={
                  unread ? `${title}, ${tNav('unreadMessages', { count: c.unreadCount })}` : title
                }
                title={title}
                className={cn(
                  'relative flex size-14 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-muted',
                  c.id === activeId && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <Avatar className="size-12">
                  {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                  <AvatarFallback
                    className={cn('text-sm font-medium text-white', avatarColor(c.id))}
                  >
                    {chatInitials(title)}
                  </AvatarFallback>
                </Avatar>
                {unread && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.65rem] font-bold tabular-nums ring-2 ring-sidebar',
                      c.muted
                        ? 'bg-muted-foreground text-background'
                        : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {c.unreadCount > 99 ? '99+' : c.unreadCount}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Ручка на правом краю колонки: тянуть — ширина, двойной щелчок — умолчание, стрелки —
 * шаг по 16 px (Home — свернуть, End — максимум). Ловит указатель полосой 8 px, видна только
 * под курсором и в фокусе.
 */
export function ChatListResizeHandle({ listWidth }: { listWidth: ChatListWidth }) {
  const t = useTranslations('Chats')
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('tgShell.resizeList')}
      aria-valuemin={0}
      aria-valuemax={LIST_MAX_W}
      aria-valuenow={listWidth.compact ? 0 : listWidth.width}
      aria-valuetext={listWidth.compact ? t('tgShell.collapseList') : undefined}
      tabIndex={0}
      {...listWidth.handleProps}
      className="absolute inset-y-0 -right-1 z-30 w-2 cursor-ew-resize touch-none outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/15"
    />
  )
}
