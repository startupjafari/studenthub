'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { BadgeCheck, BellOff, ChevronLeft, Search } from 'lucide-react'
import type { ChatListItem } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { avatarColor, chatInitials, isOfficialChat } from '../lib/format'
import { ChatHeaderIconButton } from './chat-header-button'

/**
 * Шапка открытой переписки (Telegram: MiddleHeader): «назад» на телефоне, аватар,
 * название со значками и подпись-статус, справа — поиск (на ПК) и меню «три точки».
 *
 * Нажатие на аватар и название открывает панель информации о чате, как в Telegram.
 * Подпись и меню приходят готовыми узлами: статус перерисовывается сам по присутствию,
 * а меню знает о действиях окна, которых шапке знать незачем.
 */
export function ChatHeader({
  chat,
  title,
  peerOnline,
  status,
  menu,
  extra,
  hidden,
  onBack,
  onOpenDetails,
  onSearch,
}: {
  chat: ChatListItem | undefined
  title: string
  /** Собеседник личного чата в сети — точка на аватаре. */
  peerOnline: boolean
  status: ReactNode
  menu: ReactNode
  /** Дополнительные значки перед кнопками (например, состояние связи). */
  extra?: ReactNode
  /** Шапку заменяет режим поиска или выбора сообщений; держим смонтированной. */
  hidden?: boolean
  onBack: () => void
  onOpenDetails: () => void
  onSearch: () => void
}) {
  const t = useTranslations('Chats')

  return (
    <header
      className={cn(
        'flex items-center justify-between gap-1 border-b border-border px-3 py-3 md:px-4',
        hidden && 'hidden',
      )}
    >
      {/* Назад к списку — только на телефоне: на ПК список виден рядом. */}
      <ChatHeaderIconButton aria-label={t('back')} onClick={onBack} className="md:hidden">
        <ChevronLeft aria-hidden />
      </ChatHeaderIconButton>
      {/* Подсветка при наведении идёт вровень с шапкой: отрицательные поля съедают её
          отступы, поэтому область занимает всю высоту и (на ПК, где «назад» нет) доходит
          до левого края. Скруглённый прямоугольник в рамке из пустоты читался как чужой
          элемент внутри шапки, а не как сама шапка. */}
      <button
        type="button"
        onClick={onOpenDetails}
        className="-my-3 flex min-w-0 flex-1 items-center gap-3 rounded-none px-1 py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 md:-ml-4 md:pl-4"
      >
        <span className="relative shrink-0">
          <Avatar className="size-10">
            {chat?.avatarUrl && <AvatarImage src={chat.avatarUrl} alt="" />}
            <AvatarFallback
              className={cn('text-sm font-medium text-white', avatarColor(chat?.id ?? ''))}
            >
              {chat ? chatInitials(title) : '#'}
            </AvatarFallback>
          </Avatar>
          {chat?.type === 'PRIVATE' && peerOnline && (
            <span
              className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-background bg-success"
              aria-hidden
            />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-base leading-tight font-semibold">{title}</span>
            {chat && isOfficialChat(chat.type) && (
              <BadgeCheck className="size-4 shrink-0 text-info" aria-label={t('officialChat')} />
            )}
            {chat?.muted && (
              <BellOff
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t('tgHeader.mutedBadge')}
              />
            )}
          </span>
          <span className="flex min-w-0 text-sm leading-tight text-muted-foreground">{status}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {extra}
        {/* Поиск по переписке отдельной кнопкой — на ПК, как в Telegram; на телефоне ему
            тесно в шапке, и он первым пунктом в меню. */}
        <ChatHeaderIconButton
          aria-label={t('searchInChat')}
          title={t('searchInChat')}
          aria-keyshortcuts="Control+F Meta+F"
          onClick={onSearch}
          className="hidden md:flex"
        >
          <Search aria-hidden />
        </ChatHeaderIconButton>
        {menu}
      </div>
    </header>
  )
}
