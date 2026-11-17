'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { ChatMemberInfo } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/**
 * Подсказка @-упоминаний над полем ввода (Telegram MentionTooltip): аватар, имя и подсветка
 * выбранной строки. Клавиатура живёт в поле ввода (↑/↓, Enter/Tab — выбрать, Esc — закрыть),
 * а список только показывает, кто выбран, и докручивает к нему. Фокус остаётся в тексте —
 * иначе пропал бы «@запрос» перед курсором, который список и фильтрует.
 */
export function ComposerMentionList({
  id,
  candidates,
  activeIndex,
  myId,
  onPick,
  onHover,
}: {
  id: string
  candidates: ChatMemberInfo[]
  activeIndex: number
  myId: string | undefined
  onPick: (u: ChatMemberInfo) => void
  onHover: (index: number) => void
}) {
  const t = useTranslations('Chats')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={t('tgComposer.mentionsLabel')}
      className="absolute bottom-full left-0 z-20 mb-2 max-h-60 w-full max-w-80 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg duration-(--motion-menu) animate-in fade-in-0 slide-in-from-bottom-1 lg:left-12"
    >
      {candidates.map((u, i) => (
        <div
          key={u.id}
          id={`${id}-${i}`}
          data-index={i}
          role="option"
          aria-selected={i === activeIndex}
          // Нажатие не забирает фокус у поля: иначе курсор и «@запрос» перед ним теряются.
          onMouseDown={(e) => e.preventDefault()}
          onPointerMove={() => onHover(i)}
          onClick={() => onPick(u)}
          className={cn(
            'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm',
            i === activeIndex ? 'bg-muted' : 'hover:bg-muted/60',
          )}
        >
          <Avatar className="size-8 shrink-0">
            {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
            <AvatarFallback className="text-xs">
              {(u.firstName[0] ?? '') + (u.lastName[0] ?? '')}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate">
            {u.firstName} {u.lastName}
            {u.id === myId ? ` (${t('you')})` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
