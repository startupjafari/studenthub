'use client'

import { useMemo, useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  Bell,
  BellOff,
  Bookmark,
  Check,
  CheckCheck,
  FolderCog,
  Loader2,
  MessagesSquare,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldBan,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { ChatFolder, ChatListItem } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { avatarColor, chatInitials, chatTitle, listTime, senderName, TYPE_TAG } from '../lib/format'
import { buildFolderTabs, filterChatsByTab, folderTabLabel } from '../lib/folders'

// Элемент результата поиска по сообщениям (подмножество ChatMessage + chatId).
type MsgSearchItem = {
  id: string
  chatId: string
  content: string
  createdAt: string
  sender: { firstName: string; lastName: string }
}

// Левая колонка (Telegram-стиль §2): заголовок с действиями, единый поиск (чаты + сообщения),
// список диалогов со свайп-действиями. Презентационный виджет — состояние и мутации в родителе.
export type ConversationListProps = {
  embedded: boolean
  activeId: string | null
  onOpenChat: (id: string) => void
  onBack: () => void
  newChatOpen: boolean
  onToggleNewChat: () => void
  onCloseNewChat: () => void
  onNewGroup: () => void
  onOpenSaved: () => void
  onOpenBlocked: () => void
  searchRaw: string
  onSearchChange: (v: string) => void
  onClearSearch: () => void
  searchTerm: string
  chatMatches: ChatListItem[]
  msgMatches: MsgSearchItem[]
  msgResultsLoading: boolean
  chatById: Map<string, ChatListItem>
  chats: ChatListItem[]
  chatsLoading: boolean
  myId: string | undefined
  locale: string
  swiped: { id: string; side: 'left' | 'right' } | null
  swipedFlagRef: RefObject<boolean>
  rowElsRef: RefObject<Map<string, HTMLElement>>
  onRowTouchStart: (e: React.TouchEvent<HTMLElement>, id: string) => void
  onRowTouchMove: (e: React.TouchEvent<HTMLElement>) => void
  onRowTouchEnd: (e: React.TouchEvent<HTMLElement>, id: string) => void
  onCloseSwiped: (id: string) => void
  onMarkRead: (id: string) => void
  onTogglePin: (c: ChatListItem) => void
  onToggleMute: (c: ChatListItem) => void
  // Пользовательские папки (§2) и вход в их настройку — данные и мутации живут в родителе.
  folders: ChatFolder[]
  onManageFolders: () => void
  onDeleteChat: (c: ChatListItem) => void
}

export function ConversationList({
  embedded,
  activeId,
  onOpenChat,
  onBack,
  newChatOpen,
  onToggleNewChat,
  onCloseNewChat,
  onNewGroup,
  onOpenSaved,
  onOpenBlocked,
  searchRaw,
  onSearchChange,
  onClearSearch,
  searchTerm,
  chatMatches,
  msgMatches,
  msgResultsLoading,
  chatById,
  chats,
  chatsLoading,
  myId,
  locale,
  swiped,
  swipedFlagRef,
  rowElsRef,
  onRowTouchStart,
  onRowTouchMove,
  onRowTouchEnd,
  onCloseSwiped,
  onMarkRead,
  onTogglePin,
  onToggleMute,
  onDeleteChat,
  folders,
  onManageFolders,
}: ConversationListProps) {
  const t = useTranslations('Chats')
  const [folder, setFolder] = useState<string>('folderAll')

  const folderTabs = useMemo(() => buildFolderTabs(chats, folders), [chats, folders])
  const unreadTotal = useMemo(() => chats.filter((c) => c.unreadCount > 0).length, [chats])
  const visibleChats = useMemo(
    () =>
      filterChatsByTab(
        chats,
        folderTabs.find((f) => f.id === folder),
      ),
    [chats, folderTabs, folder],
  )

  return (
    <aside
      className={cn(
        embedded
          ? 'flex h-full w-full flex-col'
          : cn(
              // lg:hidden — на десктопе список всегда живёт в сайдбаре (портал); эта
              // inline-панель нужна только для мобильного/планшета (<lg).
              'w-full shrink-0 flex-col border-r border-border md:flex md:w-80 lg:hidden',
              activeId ? 'hidden md:flex' : 'flex',
            ),
      )}
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex items-center gap-1.5">
          {embedded && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t('back')}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-lg font-bold">{t('title')}</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={t('blockedTitle')}
              title={t('blockedTitle')}
              onClick={onOpenBlocked}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
            >
              <ShieldBan className="size-5" aria-hidden />
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label={t('newChat')}
                onClick={onToggleNewChat}
                aria-expanded={newChatOpen}
                className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
              >
                <Plus
                  className={cn(
                    'size-5 transition-transform duration-200',
                    newChatOpen && 'rotate-45',
                  )}
                  aria-hidden
                />
              </button>
              {newChatOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={onCloseNewChat} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-52 origin-top-right overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 slide-in-from-top-1">
                    <button
                      type="button"
                      onClick={onNewGroup}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <Users className="size-4 shrink-0 opacity-80" aria-hidden />
                      {t('newGroup')}
                    </button>
                    <button
                      type="button"
                      onClick={onOpenSaved}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <Bookmark className="size-4 shrink-0 opacity-80" aria-hidden />
                      {t('savedMessages')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Единый поиск: по названиям чатов и по сообщениям внутри чатов. */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={searchRaw}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('searchAll')}
            className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-8 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
          />
          {searchRaw && (
            <button
              type="button"
              aria-label={t('clearSearch')}
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {/* Папки-фильтры (Telegram-стиль §2) — только вне режима поиска. */}
      {searchTerm.length < 2 && chats.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none]">
          {folderTabs.map((f) => {
            const active = folder === f.id
            const badge = f.id === 'folderUnread' && unreadTotal > 0 ? unreadTotal : null
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFolder(f.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {folderTabLabel(f, t)}
                {badge != null && (
                  <span
                    className={cn(
                      'rounded-full px-1 text-[0.6rem] tabular-nums',
                      active ? 'bg-primary-foreground/20' : 'bg-primary/15 text-primary',
                    )}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            )
          })}
          {/* Свои папки настраиваются здесь же: вкладки — единственное место, где они видны. */}
          <button
            type="button"
            onClick={onManageFolders}
            aria-label={t('foldersTitle')}
            title={t('foldersTitle')}
            className="flex size-6 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FolderCog className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <div
        key={embedded ? 'list' : activeId ? 'list-hidden' : 'list-visible'}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto',
          'duration-300 animate-in fade-in slide-in-from-left-4',
          !embedded && 'pb-[calc(6rem+env(safe-area-inset-bottom))]',
        )}
      >
        {searchTerm.length >= 2 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {chatMatches.length === 0 && msgMatches.length === 0 && !msgResultsLoading ? (
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <EmptyState
                  icon={<Search className="size-6" aria-hidden />}
                  title={t('noResults')}
                />
              </div>
            ) : (
              <>
                {chatMatches.length > 0 && (
                  <div className="flex flex-col">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('title')}
                    </p>
                    {chatMatches.map((c) => {
                      const title = chatTitle(c, t)
                      const lm = c.lastMessage
                      const preview = lm
                        ? lm.systemType
                          ? t('systemEvent')
                          : lm.content || (lm.media.length ? t('attachment') : '')
                        : ''
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            onOpenChat(c.id)
                            onClearSearch()
                          }}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-muted/50',
                            activeId === c.id ? 'bg-primary/10' : '',
                          )}
                        >
                          <Avatar className="size-10 shrink-0">
                            {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={title} />}
                            <AvatarFallback
                              className={cn('text-xs font-medium text-white', avatarColor(c.id))}
                            >
                              {chatInitials(title)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{title}</span>
                            {preview && (
                              <p className="truncate text-xs text-muted-foreground">{preview}</p>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                {(msgMatches.length > 0 || msgResultsLoading) && (
                  <div className="flex flex-col">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('messagesSection')}
                    </p>
                    {msgResultsLoading ? (
                      <div className="flex justify-center py-4 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      </div>
                    ) : (
                      msgMatches.map((m) => {
                        const chat = chatById.get(m.chatId)
                        const chatName = chat ? chatTitle(chat, t) : t('typePrivate')
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              onOpenChat(m.chatId)
                              onClearSearch()
                            }}
                            className="flex w-full cursor-pointer items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-muted/50"
                          >
                            <Avatar className="size-10 shrink-0">
                              {chat?.avatarUrl && (
                                <AvatarImage src={chat.avatarUrl} alt={chatName} />
                              )}
                              <AvatarFallback
                                className={cn(
                                  'text-xs font-medium text-white',
                                  avatarColor(m.chatId),
                                )}
                              >
                                {chatInitials(chatName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                  {chatName}
                                </span>
                                <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                                  {listTime(m.createdAt, locale)}
                                </span>
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                <span className="text-foreground/70">{senderName(m)}: </span>
                                {m.content || t('attachment')}
                              </p>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : chatsLoading ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full shrink-0 rounded-xl" />
            ))}
          </div>
        ) : visibleChats.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <EmptyState
              icon={<MessagesSquare className="size-6" aria-hidden />}
              title={t('noChats')}
            />
          </div>
        ) : (
          visibleChats.map((c) => {
            const title = chatTitle(c, t)
            const lm = c.lastMessage
            const preview = lm
              ? lm.systemType
                ? t('systemEvent')
                : lm.content || (lm.media.length ? t('attachment') : '')
              : ''
            const previewWho =
              lm && c.type !== 'PRIVATE'
                ? lm.senderId === myId
                  ? `${t('you')}: `
                  : `${lm.sender.firstName}: `
                : ''
            const lastMine = !!lm && lm.senderId === myId
            const lastRead =
              lastMine &&
              !!c.othersReadAt &&
              new Date(c.othersReadAt).getTime() >= new Date(lm!.createdAt).getTime()
            const tag = TYPE_TAG[c.type]
            return (
              <div
                key={c.id}
                className="relative overflow-hidden duration-200 animate-in fade-in slide-in-from-left-2 lg:overflow-visible"
              >
                {/* Свайп ВПРАВО: Прочитать · Закрепить (мобильный). */}
                <div className="absolute inset-y-0 left-0 z-0 flex lg:hidden">
                  <button
                    type="button"
                    aria-label={t('markRead')}
                    onClick={() => {
                      onMarkRead(c.id)
                      onCloseSwiped(c.id)
                    }}
                    className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-info px-1 text-center text-[0.6rem] font-medium leading-tight text-info-foreground"
                  >
                    <CheckCheck className="size-4" aria-hidden />
                    {t('readShort')}
                  </button>
                  <button
                    type="button"
                    aria-label={c.pinned ? t('unpin') : t('pin')}
                    onClick={() => {
                      onTogglePin(c)
                      onCloseSwiped(c.id)
                    }}
                    className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-primary px-1 text-center text-[0.6rem] font-medium leading-tight text-primary-foreground"
                  >
                    {c.pinned ? (
                      <PinOff className="size-4" aria-hidden />
                    ) : (
                      <Pin className="size-4" aria-hidden />
                    )}
                    {c.pinned ? t('unpinShort') : t('pinShort')}
                  </button>
                </div>
                {/* Свайп ВЛЕВО: Без звука · Удалить (мобильный). */}
                <div className="absolute inset-y-0 right-0 z-0 flex lg:hidden">
                  <button
                    type="button"
                    aria-label={c.muted ? t('unmute') : t('mute')}
                    onClick={() => {
                      onToggleMute(c)
                      onCloseSwiped(c.id)
                    }}
                    className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-muted px-1 text-center text-[0.6rem] font-medium leading-tight text-muted-foreground"
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
                    aria-label={t('delete')}
                    onClick={() => {
                      onCloseSwiped(c.id)
                      onDeleteChat(c)
                    }}
                    className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-destructive px-1 text-center text-[0.6rem] font-medium leading-tight text-white"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t('delete')}
                  </button>
                </div>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) rowElsRef.current.set(c.id, el)
                    else rowElsRef.current.delete(c.id)
                  }}
                  onClick={() => {
                    if (swipedFlagRef.current) {
                      swipedFlagRef.current = false
                      return
                    }
                    if (swiped) {
                      onCloseSwiped(swiped.id)
                      return
                    }
                    onOpenChat(c.id)
                  }}
                  onTouchStart={(e) => onRowTouchStart(e, c.id)}
                  onTouchMove={onRowTouchMove}
                  onTouchEnd={(e) => onRowTouchEnd(e, c.id)}
                  className={cn(
                    'relative z-10 flex w-full cursor-pointer touch-pan-y items-center gap-3 bg-background px-2 py-2 text-left transition-colors hover:bg-muted/50',
                    activeId === c.id ? 'bg-primary/10' : '',
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar className="size-12">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={title} />}
                      <AvatarFallback
                        className={cn('text-sm font-medium text-white', avatarColor(c.id))}
                      >
                        {chatInitials(title)}
                      </AvatarFallback>
                    </Avatar>
                    {c.type === 'PRIVATE' && c.online && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-success"
                        aria-hidden
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
                      {c.muted && (
                        <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      {lastMine &&
                        (lastRead ? (
                          <CheckCheck className="size-3 shrink-0 text-info" aria-hidden />
                        ) : (
                          <Check className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        ))}
                      {lm && (
                        <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                          {listTime(lm.createdAt, locale)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {previewWho && <span className="text-foreground/70">{previewWho}</span>}
                        {preview}
                      </p>
                      {c.unreadCount > 0 ? (
                        <span
                          className={cn(
                            'flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full px-1 text-[0.65rem] font-medium tabular-nums text-white',
                            c.muted ? 'bg-muted-foreground/60' : 'bg-primary',
                          )}
                        >
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
                      ) : (
                        c.pinned && (
                          <Pin
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-label={t('pinned')}
                          />
                        )
                      )}
                    </div>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">
                      <span
                        className={cn('size-1.5 shrink-0 rounded-full opacity-70', tag.dot)}
                        aria-hidden
                      />
                      {t(tag.key)}
                    </span>
                  </div>
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
