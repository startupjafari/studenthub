'use client'

import { useTranslations } from 'next-intl'
import { Archive } from 'lucide-react'
import type { ChatListItem } from '../../../entities/chat'
import { cn } from '../../../shared/lib/utils'
import { chatTitle } from '../lib/format'
import { isChatUnread } from './chat-list-row'

/** Сколько названий архивных чатов перечислять в подзаголовке — дальше строка всё равно обрезана. */
const PREVIEW_TITLES = 8

/**
 * Строка «Архив» над списком «Все» — как в Telegram: не вкладка среди папок, а отдельная
 * строка того же роста, что и чаты. В подзаголовке — названия архивных чатов через запятую,
 * непрочитанные — ярче; справа серый счётчик чатов с непрочитанным (архив заглушён по смыслу:
 * его убрали с глаз, и синий счётчик звал бы туда, откуда человек сам ушёл).
 */
export function ChatListArchiveRow({
  chats,
  onOpen,
}: {
  /** Архивные чаты в порядке списка. */
  chats: ChatListItem[]
  onOpen: () => void
}) {
  const t = useTranslations('Chats')
  const unreadChats = chats.filter(isChatUnread).length
  const titles = chats.slice(0, PREVIEW_TITLES)
  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-3 bg-background px-2 py-[0.5625rem] text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 active:bg-accent lg:rounded-xl"
      >
        <span
          className="flex size-[3.375rem] shrink-0 items-center justify-center rounded-full bg-muted-foreground/60 text-white"
          aria-hidden
        >
          <Archive className="size-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-medium leading-6">
            {t('tgList.archiveTitle')}
          </span>
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-sm leading-5 text-muted-foreground">
              {titles.map((c, i) => (
                <span key={c.id}>
                  <span className={cn(isChatUnread(c) && 'font-medium text-foreground')}>
                    {chatTitle(c, t)}
                  </span>
                  {i < titles.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
            {unreadChats > 0 && (
              <span
                className="flex h-[1.375rem] min-w-[1.375rem] shrink-0 items-center justify-center rounded-full bg-muted-foreground/60 px-1.5 text-xs font-medium tabular-nums text-white"
                aria-label={t('tgList.archiveUnread', { n: unreadChats })}
              >
                {unreadChats}
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  )
}
