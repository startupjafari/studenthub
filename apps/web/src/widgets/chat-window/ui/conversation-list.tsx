'use client'

import { useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BadgeCheck,
  Bell,
  BellOff,
  Bookmark,
  Check,
  CheckCheck,
  Eraser,
  ExternalLink,
  EyeOff,
  Folder,
  FolderCog,
  FolderPlus,
  Loader2,
  MessagesSquare,
  Pin,
  PinOff,
  Search,
  Settings,
  ShieldBan,
  Trash2,
  UserRoundSearch,
  Users,
  X,
} from 'lucide-react'
import type { ChatFolder, ChatListItem } from '../../../entities/chat'
import type { DirectoryUser } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  RowContextMenu,
  SegmentedTabs,
  Skeleton,
  captureAnchor,
  type MenuAnchor,
  type SegmentedTabItem,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  avatarColor,
  chatInitials,
  chatTitle,
  isOfficialChat,
  listTime,
  senderName,
  TYPE_TAG,
} from '../lib/format'
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
  // Люди своего вуза в той же выдаче поиска (Telegram-стиль): отдельного входа
  // «написать человеку» нет — переписка начинается прямо отсюда.
  peopleMatches: DirectoryUser[]
  peopleLoading: boolean
  onOpenPerson: (user: DirectoryUser) => void
  startingPersonId: string | null
  chatById: Map<string, ChatListItem>
  chats: ChatListItem[]
  chatsLoading: boolean
  myId: string | undefined
  locale: string
  /**
   * Список только что вернули на экран (закрыли чат). Секунда на анимацию возврата — и флаг
   * снимают: список смонтирован всегда, поэтому «появление» здесь не монтирование, а
   * одноразово навешенный класс.
   */
  returning: boolean
  swiped: { id: string; side: 'left' | 'right' } | null
  swipedFlagRef: RefObject<boolean>
  /** Долгое нажатие уже отработало — системное `contextmenu` поверх него игнорируем. */
  longPressedRef: RefObject<boolean>
  /**
   * Сюда список кладёт свой обработчик долгого нажатия: жест живёт в `useSwipeRows` у родителя,
   * а меню строки — состояние списка. Ref вместо пропса-колбэка, потому что связь обратная:
   * не родитель зовёт список, а список даёт родителю, что позвать.
   */
  longPressRef: RefObject<((id: string, el: HTMLElement) => void) | null>
  rowElsRef: RefObject<Map<string, HTMLElement>>
  onRowTouchStart: (e: React.TouchEvent<HTMLElement>, id: string) => void
  onRowTouchMove: (e: React.TouchEvent<HTMLElement>) => void
  onRowTouchEnd: (e: React.TouchEvent<HTMLElement>, id: string) => void
  onCloseSwiped: (id: string) => void
  /**
   * Кто набирает, по чатам (§1 карты). Имён здесь нет и не будет: список знает только сами
   * чаты, а тянуть справочник участников ради подписи в строке — запрос на каждое нажатие
   * клавиши у собеседника. В личном чате имя и так очевидно, в группе хватает «печатают…».
   */
  typingByChat: Record<string, Record<string, number>>
  onMarkRead: (id: string) => void
  onTogglePin: (c: ChatListItem) => void
  onToggleMute: (c: ChatListItem) => void
  onToggleArchive: (c: ChatListItem) => void
  // Пользовательские папки (§2) и вход в их настройку — данные и мутации живут в родителе.
  folders: ChatFolder[]
  onManageFolders: () => void
  // Положить чат в папку или вынуть его оттуда — прямо из меню строки, без диалога.
  onToggleChatFolder: (folderId: string, chat: ChatListItem) => void
  // Правый клик по вкладке своей папки (§1 карты): настроить её состав или удалить саму папку.
  onEditFolder: (folderId: string) => void
  onDeleteFolder: (folder: ChatFolder) => void
  // §4 карты: открыть переписку второй вкладкой браузера и открыть её, не сбрасывая
  // счётчик непрочитанного.
  onOpenInNewTab: (c: ChatListItem) => void
  onOpenUnread: (c: ChatListItem) => void
  onClearHistory: (c: ChatListItem) => void
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
  peopleMatches,
  peopleLoading,
  onOpenPerson,
  startingPersonId,
  chatById,
  chats,
  chatsLoading,
  myId,
  locale,
  returning,
  swiped,
  swipedFlagRef,
  longPressedRef,
  longPressRef,
  rowElsRef,
  onRowTouchStart,
  onRowTouchMove,
  onRowTouchEnd,
  onCloseSwiped,
  typingByChat,
  onMarkRead,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
  onOpenInNewTab,
  onOpenUnread,
  onClearHistory,
  onDeleteChat,
  folders,
  onManageFolders,
  onToggleChatFolder,
  onEditFolder,
  onDeleteFolder,
}: ConversationListProps) {
  const t = useTranslations('Chats')
  const tRoles = useTranslations('Roles')
  const [folder, setFolder] = useState<string>('folderAll')
  // Единственный вход к человеку — это поле: пустое состояние не уводит в отдельное окно,
  // а ставит курсор сюда же, где ищут чаты.
  const searchRef = useRef<HTMLInputElement>(null)
  // Поиск свёрнут в иконку, пока его не открыли; с введённым запросом он открыт всегда.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchExpanded = searchOpen || !!searchRaw
  // Если поле уже на экране — фокус сразу, иначе его даст autoFocus при появлении.
  const openSearch = (): void => {
    setSearchOpen(true)
    searchRef.current?.focus()
  }
  const closeSearch = (): void => {
    onClearSearch()
    setSearchOpen(false)
  }
  // Открытое меню действий строки: id чата + точка нажатия. Одно на список — двух сразу
  // не бывает, и по id же подсвечивается строка, к которой меню относится.
  const [rowMenu, setRowMenu] = useState<{
    id: string
    x: number
    y: number
    // Строка под пальцем: на телефоне меню строится вокруг её снимка.
    anchor?: MenuAnchor
  } | null>(null)
  // Меню вкладки папки (§1 карты). Отдельно от `rowMenu`: у строки чата и у вкладки разные
  // наборы пунктов, а одновременно открытыми они не бывают — но и делить одно состояние на
  // две сущности значило бы каждый раз выяснять, что именно сейчас под курсором.
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const openTabMenu = (value: string, e: React.MouseEvent<HTMLElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    // Клавиша «контекстное меню» шлёт событие с координатами 0,0 — там меню встало бы
    // в угол экрана. Берём прямоугольник самой вкладки, как и в меню строки.
    const box = e.currentTarget.getBoundingClientRect()
    const keyboard = e.clientX === 0 && e.clientY === 0
    setTabMenu({
      id: value,
      x: keyboard ? box.left : e.clientX,
      y: keyboard ? box.bottom : e.clientY,
    })
  }

  const openRowMenu = (e: React.MouseEvent<HTMLElement>, id: string): void => {
    e.preventDefault()
    e.stopPropagation()
    // Android шлёт `contextmenu` поверх нашего долгого нажатия — второе открытие потеряло бы
    // якорь строки и дёрнуло меню к точке касания.
    if (longPressedRef.current) return
    // Клавиша «контекстное меню» (и Shift+F10) шлёт то же событие с координатами 0,0 —
    // там меню оказалось бы в углу экрана, а не у строки. Берём её прямоугольник.
    const box = e.currentTarget.getBoundingClientRect()
    const keyboard = e.clientX === 0 && e.clientY === 0
    setRowMenu({
      id,
      x: keyboard ? box.left + 24 : e.clientX,
      y: keyboard ? box.bottom : e.clientY,
    })
  }
  // Долгое нажатие (тач): меню у самой строки, со снимком её самой над затемнением.
  longPressRef.current = (id, el) => {
    const box = el.getBoundingClientRect()
    setRowMenu({ id, x: box.left + 24, y: box.bottom, anchor: captureAnchor(el) })
  }
  const menuChat = rowMenu ? chats.find((c) => c.id === rowMenu.id) : undefined
  // Своя папка под курсором — по ней меню полное; у встроенных вкладок настраивать нечего,
  // кроме самого списка папок.
  const menuFolder = tabMenu ? folders.find((f) => f.id === tabMenu.id) : undefined

  const folderTabs = useMemo(() => buildFolderTabs(chats, folders), [chats, folders])
  // Непринятые запросы (§50) в счётчик «Непрочитанные» не идут: у них своя вкладка.
  const unreadTotal = useMemo(
    () => chats.filter((c) => !c.requestIncoming && c.unreadCount > 0).length,
    [chats],
  )
  const requestsTotal = useMemo(() => chats.filter((c) => c.requestIncoming).length, [chats])
  const visibleChats = useMemo(
    () =>
      filterChatsByTab(
        chats,
        folderTabs.find((f) => f.id === folder),
      ),
    [chats, folderTabs, folder],
  )
  // Счётчик рисуем только там, где он что-то значит: «Непрочитанные» и «Запросы».
  // Число рядом с «Личные» было бы просто длиной списка под вкладкой.
  const folderItems: SegmentedTabItem<string>[] = useMemo(
    () =>
      folderTabs.map((f) => ({
        value: f.id,
        label: folderTabLabel(f, t),
        count:
          f.id === 'folderUnread' ? unreadTotal : f.id === 'folderRequests' ? requestsTotal : 0,
      })),
    [folderTabs, t, unreadTotal, requestsTotal],
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
        // Возврат из чата: список въезжает слева — обратный ход тому, как чат выезжал справа.
        // Только на узких экранах: на десктопе список и так на месте, ему ехать неоткуда.
        returning &&
          'max-md:duration-300 max-md:animate-in max-md:fade-in max-md:slide-in-from-left-4',
      )}
    >
      {/* Шапка — одна строка: заголовок, справа поиск и меню «три точки». Поиск раскрывается
          на всю строку, а не отдельной строкой под ней: «назад» и меню на это время уходят,
          закрывает поиск крестик в поле. Высота — как у шапки чата
          (py-3 вокруг 40-px кнопок): нижние границы списка и переписки идут одной линией. */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-3">
        {embedded && !searchExpanded && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('back')}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        )}
        {searchExpanded ? (
          // Единый поиск: по названиям чатов, сообщениям внутри чатов и людям.
          <div className="relative min-w-0 flex-1 duration-200 animate-in fade-in slide-in-from-right-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchRef}
              autoFocus
              value={searchRaw}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeSearch()
                }
              }}
              // Пустое поле, из которого ушли, сворачивается обратно в заголовок.
              onBlur={() => {
                if (!searchRaw) setSearchOpen(false)
              }}
              placeholder={t('searchAll')}
              className="h-10 w-full rounded-lg border border-input bg-background pl-8 pr-8 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
            />
            <button
              type="button"
              aria-label={t('clearSearch')}
              onClick={closeSearch}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-lg font-bold">{t('title')}</span>
            <button
              type="button"
              aria-label={t('search')}
              title={t('search')}
              onClick={openSearch}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
            >
              <Search className="size-5" aria-hidden />
            </button>
          </>
        )}
        <div className={cn('relative shrink-0', searchExpanded && 'hidden')}>
          <button
            type="button"
            aria-label={t('listMenu')}
            onClick={onToggleNewChat}
            aria-expanded={newChatOpen}
            className={cn(
              'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90',
              newChatOpen && 'bg-muted text-foreground',
            )}
          >
            <Settings className="size-5" aria-hidden />
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
                <button
                  type="button"
                  onClick={() => {
                    onCloseNewChat()
                    onManageFolders()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <FolderCog className="size-4 shrink-0 opacity-80" aria-hidden />
                  {t('foldersManage')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCloseNewChat()
                    onOpenBlocked()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <ShieldBan className="size-4 shrink-0 opacity-80" aria-hidden />
                  {t('blockedTitle')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {/* Папки-фильтры (Telegram-стиль §2) — только вне режима поиска. Тот же
          SegmentedTabs, что у фильтров уведомлений: один вид у всех рядов-фильтров
          продукта, и вся механика ряда (прокрутка колесом и перетаскиванием, затухание
          у краёв, доводка активной вкладки) приходит вместе с ним. Свои чипы были
          отдельным языком: заливка `bg-primary` целиком и цель в 28px на десктопе. */}
      {searchTerm.length < 2 && chats.length > 0 && (
        <div className="flex items-center border-b border-border px-2 py-1">
          {/* Кнопки настройки рядом с рядом нет: «Настроить папки» живёт в меню шапки.
              Ряд вкладок — навигация, и постоянная кнопка-шестерёнка на его краю отъедала
              место у самих папок ровно там, где их и не хватает — на телефоне. */}
          <SegmentedTabs
            className="min-w-0 flex-1"
            items={folderItems}
            value={folder}
            onChange={setFolder}
            onItemContextMenu={openTabMenu}
            // Полоса над списком чатов, а не шапка страницы: высоту забирает список.
            compact
            // Сворачивать нечего: колонка чатов на узком экране занимает весь экран,
            // и ряд папок — её единственная навигация.
            collapsible={false}
            aria-label={t('foldersTitle')}
          />
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
            {chatMatches.length === 0 &&
            msgMatches.length === 0 &&
            peopleMatches.length === 0 &&
            !msgResultsLoading &&
            !peopleLoading ? (
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <EmptyState
                  icon={<Search className="size-6" aria-hidden />}
                  title={t('noResults')}
                />
              </div>
            ) : (
              <>
                {chatMatches.length > 0 && (
                  <div className="flex shrink-0 flex-col">
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
                {(peopleMatches.length > 0 || peopleLoading) && (
                  <div className="flex shrink-0 flex-col">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('peopleSection')}
                    </p>
                    {peopleLoading && peopleMatches.length === 0 ? (
                      <div className="flex justify-center py-4 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      </div>
                    ) : (
                      peopleMatches.map((u) => {
                        const name = [u.lastName, u.firstName].filter(Boolean).join(' ')
                        const busy = startingPersonId === u.id
                        return (
                          <button
                            key={u.id}
                            type="button"
                            disabled={startingPersonId !== null}
                            onClick={() => onOpenPerson(u)}
                            className="flex w-full cursor-pointer items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:opacity-70"
                          >
                            <Avatar className="size-10 shrink-0">
                              {u.avatarUrl && (
                                <AvatarImage src={u.avatarThumbUrl ?? u.avatarUrl} alt="" />
                              )}
                              <AvatarFallback
                                className={cn('text-xs font-medium text-white', avatarColor(u.id))}
                              >
                                {chatInitials(name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{name}</span>
                              <p className="truncate text-xs text-muted-foreground">
                                {[u.headline || tRoles(u.role), u.groupName || u.facultyName]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            {busy ? (
                              <Loader2
                                className="size-4 shrink-0 animate-spin text-muted-foreground"
                                aria-hidden
                              />
                            ) : (
                              // Другу сообщение уйдёт сразу — помечаем только тех, кому
                              // сначала уйдёт запрос: об этом лучше знать до клика.
                              !u.isFriend && (
                                <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                                  {t('willRequest')}
                                </span>
                              )
                            )}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
                {(msgMatches.length > 0 || msgResultsLoading) && (
                  <div className="flex shrink-0 flex-col">
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
              description={t('noChatsHint')}
              action={
                <Button size="sm" onClick={openSearch}>
                  <UserRoundSearch className="size-4" aria-hidden />
                  {t('findPeople')}
                </Button>
              }
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
            // «Печатает» вытесняет превью последнего сообщения: пока собеседник набирает,
            // это и есть самое свежее, что происходит в чате.
            const typingHere = Object.keys(typingByChat[c.id] ?? {}).length
            return (
              <div
                key={c.id}
                // shrink-0 обязателен: строки — flex-элементы прокручиваемой колонки, а
                // overflow-hidden (панели свайпа) снимает с них авто-минимум по контенту.
                // Без него длинный список ужимался по высоте, и аватары резались пополам.
                onContextMenu={(e) => openRowMenu(e, c.id)}
                className="relative shrink-0 overflow-hidden duration-200 animate-in fade-in slide-in-from-left-2 lg:overflow-visible"
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
                {/* Свайп ВЛЕВО: Без звука · Архив · Удалить (мобильный). */}
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
                    aria-label={c.archived ? t('unarchive') : t('archive')}
                    onClick={() => {
                      onToggleArchive(c)
                      onCloseSwiped(c.id)
                    }}
                    className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-secondary px-1 text-center text-[0.6rem] font-medium leading-tight text-secondary-foreground"
                  >
                    {c.archived ? (
                      <ArchiveRestore className="size-4" aria-hidden />
                    ) : (
                      <Archive className="size-4" aria-hidden />
                    )}
                    {c.archived ? t('unarchiveShort') : t('archiveShort')}
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
                  // Метка для правила в globals.css: удержание открывает меню, а не системное
                  // выделение текста строки.
                  data-long-press=""
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
                    'relative z-10 flex w-full cursor-pointer touch-pan-y items-center gap-3 bg-background px-2 py-2 text-left transition-colors duration-150 hover:bg-muted/50 active:bg-muted/70',
                    activeId === c.id ? 'bg-primary/10' : '',
                    // Строка, над которой открыто меню, выделена всё время его жизни:
                    // список длинный, курсор уезжает к пунктам меню, и без метки
                    // непонятно, какой именно чат сейчас удаляют.
                    rowMenu?.id === c.id && (activeId === c.id ? 'bg-primary/20' : 'bg-muted'),
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
                      <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
                      {/* Знак подлинности официального чата (§7 карты) — синий, как ссылки
                          и всё прочее «настоящее»: он утверждает происхождение, а не статус. */}
                      {isOfficialChat(c.type) && (
                        <BadgeCheck
                          className="size-3.5 shrink-0 text-info"
                          aria-label={t('officialChat')}
                        />
                      )}
                      <span className="flex-1" aria-hidden />
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
                      {typingHere > 0 ? (
                        <p className="min-w-0 flex-1 truncate text-xs text-primary">
                          {typingHere > 1 ? t('typingMany') : t('typingStatus')}
                        </p>
                      ) : (
                        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {previewWho && <span className="text-foreground/70">{previewWho}</span>}
                          {preview}
                        </p>
                      )}
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

      {tabMenu && (
        <RowContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          ariaLabel={t('foldersTitle')}
          onClose={() => setTabMenu(null)}
          items={
            menuFolder
              ? [
                  {
                    key: 'folder-edit',
                    icon: FolderCog,
                    label: t('folderEdit'),
                    onClick: () => onEditFolder(menuFolder.id),
                  },
                  {
                    key: 'folder-delete',
                    icon: Trash2,
                    label: t('foldersDelete'),
                    onClick: () => onDeleteFolder(menuFolder),
                    danger: true,
                  },
                ]
              : [
                  // Встроенную вкладку не удалить и не переименовать — её состав задаёт тип
                  // чата. Единственное осмысленное действие отсюда — общий экран папок.
                  {
                    key: 'folders-manage',
                    icon: FolderCog,
                    label: t('foldersManage'),
                    onClick: onManageFolders,
                  },
                ]
          }
        />
      )}

      {rowMenu && menuChat && (
        <RowContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          anchor={rowMenu.anchor}
          ariaLabel={t('chatActions')}
          onClose={() => setRowMenu(null)}
          items={[
            {
              key: 'openNewTab',
              icon: ExternalLink,
              label: t('openInNewTab'),
              onClick: () => onOpenInNewTab(menuChat),
            },
            // «Посмотреть и не прочитать» имеет смысл только там, где есть что не читать.
            ...(menuChat.unreadCount > 0
              ? [
                  {
                    key: 'openUnread',
                    icon: EyeOff,
                    label: t('openWithoutReading'),
                    onClick: () => onOpenUnread(menuChat),
                  },
                  {
                    key: 'markRead',
                    icon: CheckCheck,
                    label: t('markRead'),
                    onClick: () => onMarkRead(menuChat.id),
                  },
                ]
              : []),
            {
              key: 'pin',
              icon: menuChat.pinned ? PinOff : Pin,
              label: menuChat.pinned ? t('unpin') : t('pin'),
              onClick: () => onTogglePin(menuChat),
            },
            {
              key: 'mute',
              icon: menuChat.muted ? Bell : BellOff,
              label: menuChat.muted ? t('unmute') : t('mute'),
              onClick: () => onToggleMute(menuChat),
            },
            {
              key: 'folders',
              icon: FolderPlus,
              label: t('folderAdd'),
              // Папок ещё нет — вести в пустой список некуда, открываем их настройку.
              ...(folders.length === 0
                ? { onClick: onManageFolders }
                : {
                    items: [
                      ...[...folders]
                        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                        .map((f) => ({
                          key: `folder-${f.id}`,
                          icon: Folder,
                          label: f.name,
                          // Галочка = чат уже в папке; повторное нажатие вынимает его.
                          checked: f.chatIds.includes(menuChat.id),
                          // Меню остаётся открытым: папок обычно несколько, и после
                          // каждого нажатия заново вызывать его было бы мучением.
                          keepOpen: true,
                          onClick: () => onToggleChatFolder(f.id, menuChat),
                        })),
                      {
                        key: 'folders-manage',
                        icon: FolderCog,
                        label: t('foldersManage'),
                        onClick: onManageFolders,
                      },
                    ],
                  }),
            },
            {
              key: 'archive',
              icon: menuChat.archived ? ArchiveRestore : Archive,
              label: menuChat.archived ? t('unarchive') : t('archive'),
              onClick: () => onToggleArchive(menuChat),
            },
            {
              key: 'clear',
              icon: Eraser,
              label: t('clearHistory'),
              onClick: () => onClearHistory(menuChat),
            },
            {
              key: 'delete',
              icon: Trash2,
              label: t('delete'),
              onClick: () => onDeleteChat(menuChat),
              danger: true,
            },
          ]}
        />
      )}
    </aside>
  )
}
