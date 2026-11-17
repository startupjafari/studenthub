'use client'

import { useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Eraser,
  Forward,
  MessageCircleDashed,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { ChatListItem } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { avatarColor, chatInitials, chatTitle, isOfficialChat, plainPreview } from '../lib/format'
import { chatListTime } from '../lib/list-time'
import { canDeleteChat } from '../lib/chat-kind'
import { MessagePreview } from './chat-list-preview'

/** Чат «непрочитан» для строки: есть непрочитанные или стоит пометка «как новое». */
export function isChatUnread(c: ChatListItem): boolean {
  return c.unreadCount > 0 || !!c.markedUnread
}

export type ChatListRowHandlers = {
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void
  onTouchStart: (e: React.TouchEvent<HTMLElement>) => void
  onTouchMove: (e: React.TouchEvent<HTMLElement>) => void
  onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void
  /** Действия панелей свайпа; каждое само закрывает панель. */
  onToggleRead: () => void
  onTogglePin: () => void
  onToggleMute: () => void
  onToggleArchive: () => void
  onDelete: () => void
  onClearHistory: () => void
}

export type ChatListRowProps = {
  chat: ChatListItem
  active: boolean
  /** Над строкой открыто её меню — подсветка на всё время его жизни. */
  menuOpen: boolean
  myId: string | undefined
  locale: string
  /** «печатает…» и прочие действия собеседника — вытесняют превью. */
  actionLabel: string | null
  /** Обёртка строки — её двигает анимация перестановки. */
  rowRef: (el: HTMLElement | null) => void
  /** Сама кнопка строки — её двигает свайп. */
  buttonRef: (el: HTMLButtonElement | null) => void
  handlers: ChatListRowHandlers
}

// Кнопки свайпа без aria-label: имя — видимая короткая подпись. Длинная («Отметить
// прочитанным») не содержала бы видимой и расходилась с ней для голосового управления
// (WCAG 2.5.3).
const SWIPE_BTN =
  'flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap px-1 text-center text-[0.6rem] font-medium leading-tight'

/**
 * Строка списка чатов в раскладке Telegram: 72 px, аватар 54 px, две строки текста.
 *
 * Верх — название, знак подлинности, «без звука», справа галочки прочтения и время. Низ —
 * «печатает…», черновик красным или превью последнего сообщения с именем отправителя и
 * миниатюрой медиа; справа счётчик непрочитанного (серый у заглушённых), точка «как новое»
 * или скрепка закреплённого.
 *
 * На ПК выбранная строка залита основным цветом, как в Telegram Web: в длинном списке
 * открытый чат находится глазом сразу. На телефоне выбранной строки не видно — список
 * уступает экран переписке.
 */
export function ChatListRow({
  chat: c,
  active,
  menuOpen,
  myId,
  locale,
  actionLabel,
  rowRef,
  buttonRef,
  handlers: h,
}: ChatListRowProps) {
  const t = useTranslations('Chats')
  const title = chatTitle(c, t)
  const lm = c.lastMessage
  const isSaved = c.type === 'SAVED'
  const lastMine = !!lm && lm.senderId === myId && !lm.systemType
  const lastRead =
    lastMine &&
    !!c.othersReadAt &&
    new Date(c.othersReadAt).getTime() >= new Date(lm?.createdAt ?? 0).getTime()
  // Черновик показываем у всех, кроме открытого чата: там он и так в поле ввода.
  const draft = !active && c.draft ? plainPreview(c.draft) : ''
  // Имя отправителя — только в группах: в личном чате оно очевидно, а «Вы:» там лишнее.
  const previewWho =
    lm && c.type !== 'PRIVATE' && !isSaved && !lm.systemType
      ? lm.senderId === myId
        ? t('you')
        : lm.sender.firstName
      : ''
  const unread = isChatUnread(c)
  // На ПК выбранная строка залита основным цветом — тексты и значки на ней светлые.
  const sel = active

  return (
    <div
      ref={rowRef}
      // shrink-0 обязателен: строки — flex-элементы прокручиваемой колонки, а overflow-hidden
      // (панели свайпа) снимает с них авто-минимум по контенту — без него строки ужимались.
      onContextMenu={h.onContextMenu}
      className="relative shrink-0 overflow-hidden lg:overflow-visible"
    >
      {/* Свайп ВПРАВО: Прочитано/Непрочитано · Закрепить (только тач-раскладка). */}
      <div className="absolute inset-y-0 left-0 z-0 flex lg:hidden">
        <button
          type="button"
          onClick={h.onToggleRead}
          className={cn(SWIPE_BTN, 'bg-info text-info-foreground')}
        >
          {unread ? (
            <CheckCheck className="size-4" aria-hidden />
          ) : (
            <MessageCircleDashed className="size-4" aria-hidden />
          )}
          {unread ? t('readShort') : t('tgList.unreadShort')}
        </button>
        <button
          type="button"
          onClick={h.onTogglePin}
          className={cn(SWIPE_BTN, 'bg-primary text-primary-foreground')}
        >
          {c.pinned ? (
            <PinOff className="size-4" aria-hidden />
          ) : (
            <Pin className="size-4" aria-hidden />
          )}
          {c.pinned ? t('unpinShort') : t('pinShort')}
        </button>
      </div>
      {/* Свайп ВЛЕВО: Без звука · Архив · Удалить (только тач-раскладка). */}
      <div className="absolute inset-y-0 right-0 z-0 flex lg:hidden">
        <button
          type="button"
          onClick={h.onToggleMute}
          className={cn(SWIPE_BTN, 'bg-muted text-muted-foreground')}
        >
          {c.muted ? (
            <Bell className="size-4" aria-hidden />
          ) : (
            <BellOff className="size-4" aria-hidden />
          )}
          {c.muted ? t('unmuteShort') : t('muteShort')}
        </button>
        <button
          type="button"
          onClick={h.onToggleArchive}
          className={cn(SWIPE_BTN, 'bg-secondary text-secondary-foreground')}
        >
          {c.archived ? (
            <ArchiveRestore className="size-4" aria-hidden />
          ) : (
            <Archive className="size-4" aria-hidden />
          )}
          {c.archived ? t('unarchiveShort') : t('archiveShort')}
        </button>
        {/* Официальный чат и «Сохранённые» не удаляются (F-F17) — на месте «Удалить» очистка
            истории: ширина панели свайпа от этого не меняется. */}
        {canDeleteChat(c.type) ? (
          <button
            type="button"
            onClick={h.onDelete}
            className={cn(SWIPE_BTN, 'bg-destructive text-white')}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('delete')}
          </button>
        ) : (
          <button
            type="button"
            onClick={h.onClearHistory}
            className={cn(SWIPE_BTN, 'bg-destructive text-white')}
          >
            <Eraser className="size-4" aria-hidden />
            {t('clearHistoryShort')}
          </button>
        )}
      </div>
      <button
        type="button"
        // Метка для правила в globals.css: удержание открывает меню, а не выделение текста.
        data-long-press=""
        // Метка для стрелок ↑/↓ в списке (ConversationList).
        data-chat-row=""
        ref={buttonRef}
        onClick={h.onOpen}
        onTouchStart={h.onTouchStart}
        onTouchMove={h.onTouchMove}
        onTouchEnd={h.onTouchEnd}
        aria-current={active ? 'true' : undefined}
        className={cn(
          // Фон НЕПРОЗРАЧНЫЙ: строка лежит поверх панелей свайпа и закрывает их собой.
          'group/row relative z-10 flex w-full cursor-pointer touch-pan-y items-center gap-3 bg-background px-2 py-[0.5625rem] text-left transition-colors duration-150 hover:bg-muted active:bg-accent lg:rounded-xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
          menuOpen && 'bg-muted',
          sel && 'bg-primary/10 md:bg-primary md:hover:bg-primary md:active:bg-primary',
        )}
      >
        <span className="relative shrink-0">
          <Avatar className="size-[3.375rem]">
            {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
            <AvatarFallback className={cn('text-base font-medium text-white', avatarColor(c.id))}>
              {chatInitials(title)}
            </AvatarFallback>
          </Avatar>
          {c.type === 'PRIVATE' && c.online && (
            <span
              className={cn(
                'absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-background bg-success transition-colors duration-150 motion-safe:animate-in motion-safe:zoom-in-50',
                'group-hover/row:border-muted',
                sel && 'md:border-primary md:group-hover/row:border-primary',
              )}
              aria-label={t('tgList.online')}
              role="img"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                'min-w-0 truncate text-base font-medium leading-6',
                sel && 'md:text-primary-foreground',
              )}
            >
              {title}
            </span>
            {/* Знак подлинности официального чата (§7 карты): под деканат или поддержку проще
                всего подделаться названием обычной группы. */}
            {isOfficialChat(c.type) && (
              <BadgeCheck
                className={cn('size-4 shrink-0 text-info', sel && 'md:text-primary-foreground')}
                aria-label={t('officialChat')}
              />
            )}
            {c.muted && !isSaved && (
              <BellOff
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground',
                  sel && 'md:text-primary-foreground/80',
                )}
                aria-label={t('tgList.muted')}
              />
            )}
            <span className="flex-1" aria-hidden />
            {lastMine &&
              !isSaved &&
              (lastRead ? (
                <CheckCheck
                  className={cn(
                    'size-4 shrink-0 text-success',
                    sel && 'md:text-primary-foreground',
                  )}
                  aria-label={t('tgList.read')}
                />
              ) : (
                <Check
                  className={cn(
                    'size-4 shrink-0 text-success',
                    sel && 'md:text-primary-foreground',
                  )}
                  aria-label={t('tgList.sent')}
                />
              ))}
            {lm && (
              <time
                dateTime={lm.createdAt}
                className={cn(
                  'shrink-0 text-xs tabular-nums text-muted-foreground',
                  sel && 'md:text-primary-foreground/80',
                )}
              >
                {chatListTime(lm.createdAt, locale)}
              </time>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <p
              className={cn(
                'min-w-0 flex-1 truncate text-sm leading-5',
                actionLabel ? 'text-primary' : 'text-muted-foreground',
                sel && 'md:text-primary-foreground/80',
              )}
            >
              {actionLabel ? (
                actionLabel
              ) : draft ? (
                <>
                  <span className={cn('text-destructive', sel && 'md:text-primary-foreground')}>
                    {t('tgList.draft')}{' '}
                  </span>
                  {draft}
                </>
              ) : (
                <>
                  {previewWho && (
                    <span className={cn('text-foreground', sel && 'md:text-primary-foreground')}>
                      {previewWho}:{' '}
                    </span>
                  )}
                  {lm?.forwardedFromId && (
                    <Forward
                      className="-mt-px mr-1 inline size-3.5 align-text-bottom"
                      aria-label={t('tgList.forwarded')}
                    />
                  )}
                  <MessagePreview message={lm} withThumb />
                </>
              )}
            </p>
            <ChatListBadge chat={c} selected={sel} />
          </div>
        </div>
      </button>
    </div>
  )
}

/**
 * Значок справа во второй строке: счётчик непрочитанного, точка «как новое» или скрепка
 * закреплённого — один из них, по важности. У заглушённого чата счётчик серый: он про
 * сообщения, ради которых человек сам попросил не беспокоить.
 *
 * Счётчика упоминаний (@) и реакций здесь нет: `GET /chats` их не отдаёт (см. отчёт).
 */
export function ChatListBadge({ chat: c, selected }: { chat: ChatListItem; selected: boolean }) {
  const t = useTranslations('Chats')
  const count = c.unreadCount
  if (count > 0 || c.markedUnread) {
    return (
      <span
        className={cn(
          'flex h-[1.375rem] min-w-[1.375rem] shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums motion-safe:animate-in motion-safe:zoom-in-50',
          c.muted ? 'bg-muted-foreground/60 text-white' : 'bg-primary text-primary-foreground',
          selected &&
            (c.muted
              ? 'md:bg-primary-foreground/30 md:text-primary-foreground'
              : 'md:bg-primary-foreground md:text-primary'),
        )}
        aria-label={count > 0 ? t('tgList.unreadCount', { n: count }) : t('tgList.markedUnread')}
      >
        {count > 0 ? (count > 999 ? `${Math.floor(count / 1000)}K` : count) : null}
      </span>
    )
  }
  if (c.pinned) {
    return (
      <Pin
        className={cn(
          'size-4 shrink-0 rotate-45 text-muted-foreground',
          selected && 'md:text-primary-foreground/80',
        )}
        aria-label={t('pinned')}
      />
    )
  }
  return null
}
