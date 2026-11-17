'use client'

import { useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  BellOff,
  Bookmark,
  CheckCheck,
  Eraser,
  ExternalLink,
  EyeOff,
  Folder,
  FolderCog,
  FolderPlus,
  Loader2,
  MessageCircleDashed,
  MessagesSquare,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Settings,
  ShieldBan,
  Trash2,
  UserRoundSearch,
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
  captureAnchor,
  type MenuAnchor,
  type RowContextMenuItem,
  type SegmentedTabItem,
} from '../../../shared/ui'
import { useBackClose } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { avatarColor, chatInitials, chatTitle, listTime, senderName } from '../lib/format'
import { buildFolderTabs, filterChatsByTab, folderTabLabel, type FolderTab } from '../lib/folders'
import { summarizeActors, type ActionsByChat } from '../lib/chat-actions'
import { canDeleteChat } from '../lib/chat-kind'
import { useChatActionLabel } from '../lib/use-chat-action-label'
import { useChatListActions } from '../lib/use-chat-list-actions'
import { useListReorder } from '../lib/use-list-reorder'
import { MessagePreview } from './chat-list-preview'
import { ChatListRow, isChatUnread } from './chat-list-row'
import { ChatListArchiveRow } from './chat-list-archive-row'
import { ChatListFab } from './chat-list-fab'

// Сроки «Без звука» в меню строки — те же, что в шапке чата (§17).
const MUTE_OPTIONS: { key: string; minutes?: number }[] = [
  { key: 'mute1h', minutes: 60 },
  { key: 'mute8h', minutes: 480 },
  { key: 'mute1d', minutes: 1440 },
  { key: 'mute3d', minutes: 4320 },
  { key: 'muteForever' },
]

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
  /** Список не загрузился — вместо пустоты сообщение и «Повторить» (FRONTEND_RULES §9). */
  chatsError?: boolean
  onRetryChats?: () => void
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
  actionsByChat: ActionsByChat
  onMarkRead: (id: string) => void
  onTogglePin: (c: ChatListItem) => void
  onToggleMute: (c: ChatListItem) => void
  /** Заглушить на время (минуты; без них — навсегда) — подменю «Без звука» строки. */
  onMuteFor?: (c: ChatListItem, minutes?: number) => void
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
  chatsError,
  onRetryChats,
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
  actionsByChat,
  onMarkRead,
  onTogglePin,
  onToggleMute,
  onMuteFor,
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
  const tCommon = useTranslations('Common')
  const actionLabelOf = useChatActionLabel()
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

  const listActions = useChatListActions()
  // Курсор над колонкой / фокус внутри — для плавающей кнопки на ПК.
  const [peek, setPeek] = useState(false)
  const [focusIn, setFocusIn] = useState(false)
  // Архив — не вкладка среди папок, а строка над «Все» и свой экран (Telegram-стиль).
  const [archiveOpen, setArchiveOpen] = useState(false)
  const allTabs = useMemo(() => buildFolderTabs(chats, folders), [chats, folders])
  const archiveTab = allTabs.find((f) => f.kind === 'builtin' && f.archive)
  const folderTabs = useMemo(
    () => allTabs.filter((f) => !(f.kind === 'builtin' && f.archive)),
    [allTabs],
  )
  // Без вкладки архива (архив пуст) — пустой список: filterChatsByTab без вкладки отдал бы «Все».
  const archivedChats = useMemo(
    () => (archiveTab ? filterChatsByTab(chats, archiveTab) : []),
    [chats, archiveTab],
  )
  // Архив опустел (вернули последний чат) — экран архива закрывается сам.
  const showArchive = archiveOpen && archivedChats.length > 0
  const currentTab: FolderTab | undefined = showArchive
    ? archiveTab
    : folderTabs.find((f) => f.id === folder)
  const visibleChats = useMemo(() => filterChatsByTab(chats, currentTab), [chats, currentTab])

  // Счётчик у каждой папки — число чатов с непрочитанным, как в Telegram: по ряду вкладок
  // видно, куда заглянуть. У «Запросов» — сами запросы: непрочитанных в них не бывает, а
  // ждут они ответа все.
  const folderItems: SegmentedTabItem<string>[] = useMemo(
    () =>
      folderTabs.map((f) => {
        const inTab = filterChatsByTab(chats, f)
        const count =
          f.kind === 'builtin' && f.requests ? inTab.length : inTab.filter(isChatUnread).length
        return { value: f.id, label: folderTabLabel(f, t), count }
      }),
    [folderTabs, chats, t],
  )

  // Перестановка строк при новом сообщении — плавно (FLIP); смена папки — не перестановка.
  const listKey = `${showArchive ? 'archive' : folder}:${embedded ? 'e' : activeId ? 'h' : 'v'}`
  const registerRow = useListReorder(
    useMemo(() => visibleChats.map((c) => c.id), [visibleChats]),
    listKey,
  )

  // Открыть чат из строки. Пометку «как новое» без настоящих непрочитанных снимаем сами:
  // сервер снимает её прочтением, а читать в таком чате нечего — точка висела бы вечно.
  const openRow = (c: ChatListItem): void => {
    if (c.markedUnread && c.unreadCount === 0) listActions.setMarkedUnread(c.id, false)
    onOpenChat(c.id)
  }
  // «Прочитано» / «Непрочитано» — одна кнопка, как в Telegram: свайп и пункт меню.
  const toggleRead = (c: ChatListItem): void => {
    if (c.unreadCount > 0) onMarkRead(c.id)
    else if (c.markedUnread) listActions.setMarkedUnread(c.id, false)
    else listActions.setMarkedUnread(c.id, true)
  }

  // Непрочитанные чаты вкладки, над которой открыто меню, — для «Прочитать все».
  const tabMenuUnreadIds = useMemo(() => {
    if (!tabMenu) return []
    const tab = allTabs.find((f) => f.id === tabMenu.id)
    if (!tab) return []
    return filterChatsByTab(chats, tab)
      .filter(isChatUnread)
      .map((c) => c.id)
  }, [tabMenu, allTabs, chats])

  // Пункты меню строки чата. Порядок — как в Telegram: открыть, прочитанность, закрепить,
  // звук, папка, архив; опасное — в конце и за линией (RowContextMenu сам их отделит).
  const rowMenuItems = (c: ChatListItem): RowContextMenuItem[] => {
    const unread = isChatUnread(c)
    return [
      {
        key: 'openNewTab',
        icon: ExternalLink,
        label: t('openInNewTab'),
        onClick: () => onOpenInNewTab(c),
      },
      // «Посмотреть и не прочитать» имеет смысл только там, где есть что не читать.
      ...(c.unreadCount > 0
        ? [
            {
              key: 'openUnread',
              icon: EyeOff,
              label: t('openWithoutReading'),
              onClick: () => onOpenUnread(c),
            },
          ]
        : []),
      {
        key: 'read',
        icon: unread ? CheckCheck : MessageCircleDashed,
        label: unread ? t('markRead') : t('tgList.markUnread'),
        onClick: () => toggleRead(c),
      },
      {
        key: 'pin',
        icon: c.pinned ? PinOff : Pin,
        label: c.pinned ? t('unpin') : t('pin'),
        onClick: () => onTogglePin(c),
      },
      c.muted || !onMuteFor
        ? {
            key: 'mute',
            icon: c.muted ? Bell : BellOff,
            label: c.muted ? t('unmute') : t('mute'),
            onClick: () => onToggleMute(c),
          }
        : {
            key: 'mute',
            icon: BellOff,
            label: t('mute'),
            items: MUTE_OPTIONS.map((o) => ({
              key: `mute-${o.key}`,
              icon: BellOff,
              label: t(o.key),
              onClick: () => onMuteFor(c, o.minutes),
            })),
          },
      {
        key: 'folders',
        icon: FolderPlus,
        label: t('folderAdd'),
        // Папок ещё нет — вести в пустой список некуда, открываем их настройку.
        ...(folders.length === 0
          ? { onClick: onManageFolders }
          : {
              // Во втором меню — только папки: человек отвечает на один вопрос — «в каких
              // папках этот чат». Галочка = уже в папке; повторное нажатие вынимает его.
              items: [...folders]
                .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                .map((f) => ({
                  key: `folder-${f.id}`,
                  icon: Folder,
                  label: f.name,
                  checked: f.chatIds.includes(c.id),
                  // Меню остаётся открытым: папок обычно несколько.
                  keepOpen: true,
                  onClick: () => onToggleChatFolder(f.id, c),
                })),
            }),
      },
      {
        key: 'archive',
        icon: c.archived ? ArchiveRestore : Archive,
        label: c.archived ? t('unarchive') : t('archive'),
        onClick: () => onToggleArchive(c),
      },
      {
        key: 'clear',
        icon: Eraser,
        label: t('clearHistory'),
        onClick: () => onClearHistory(c),
      },
      // Официальный чат и «Сохранённые» не удаляются (F-F17): первый вернулся бы сам, вторые
      // потеряли бы заметки. Для них есть «Очистить историю» и «Архив» выше.
      ...(canDeleteChat(c.type)
        ? [
            {
              key: 'delete',
              icon: Trash2,
              label: t('delete'),
              onClick: () => onDeleteChat(c),
              danger: true,
            },
          ]
        : []),
    ]
  }

  // Стрелки ↑/↓ ходят по строкам списка, как в Telegram: Tab через сотню чатов — мучение.
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const target = e.target as HTMLElement
    if (!target.matches('[data-chat-row]')) return
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-chat-row]')]
    const i = rows.indexOf(target)
    const next = rows[e.key === 'ArrowDown' ? i + 1 : i - 1]
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  return (
    <aside
      // Курсор над колонкой или фокус в ней — выезжает плавающая кнопка «Новое сообщение».
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setPeek(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setPeek(false)
      }}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false)
      }}
      className={cn(
        'relative',
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
          'max-md:duration-(--motion-page) max-md:animate-in max-md:fade-in max-md:slide-in-from-left-4',
      )}
    >
      {/* Шапка — одна строка: заголовок, справа поиск и меню «три точки». Поиск раскрывается
          на всю строку, а не отдельной строкой под ней: «назад» и меню на это время уходят,
          закрывает поиск крестик в поле. Высота — как у шапки чата
          (py-3 вокруг 40-px кнопок): нижние границы списка и переписки идут одной линией. */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-3">
        {(showArchive || embedded) && !searchExpanded && (
          <button
            type="button"
            // В архиве «назад» ведёт к списку чатов, а не со страницы.
            onClick={showArchive ? () => setArchiveOpen(false) : onBack}
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
              className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
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
              className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-10 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
            />
            {/* Крестик — кнопка 32×32, а не 20×20 по размеру значка: в маленький квадрат
                у края поля промахивались и попадали в само поле. */}
            <button
              type="button"
              aria-label={t('clearSearch')}
              onClick={closeSearch}
              className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-lg font-bold">
              {showArchive ? t('tgList.archiveTitle') : t('title')}
            </span>
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
        <div className={cn('relative shrink-0', (searchExpanded || showArchive) && 'hidden')}>
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
      {showArchive && <ArchiveBackClose onClose={() => setArchiveOpen(false)} />}
      {searchTerm.length < 2 && chats.length > 0 && !showArchive && (
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
          'duration-(--motion-page) animate-in fade-in slide-in-from-left-4',
          // Снизу — место под нижнюю навигацию и плавающую кнопку: последняя строка
          // прокручивается из-под них, а не прячется.
          embedded ? 'pb-20' : 'pb-[calc(9rem+env(safe-area-inset-bottom))]',
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
                            {lm && (
                              <p className="truncate text-xs text-muted-foreground">
                                <MessagePreview message={lm} />
                              </p>
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
                                <MessagePreview message={m} />
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
          // Пока список едет — пусто. Скелетон-заглушка рисовала десять несуществующих
          // строк, которые тут же сменялись настоящими: мельтешение вместо ожидания.
          // Ветку всё равно держим отдельно от «чатов нет»: иначе на секунду загрузки
          // показывалось бы пустое состояние, и человек успевал бы поверить, что чатов нет.
          <div className="min-h-0 flex-1" />
        ) : chatsError && chats.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <EmptyState
              icon={<MessagesSquare className="size-6" aria-hidden />}
              title={t('tgList.loadError')}
              action={
                onRetryChats && (
                  <Button size="sm" variant="outline" onClick={onRetryChats}>
                    <RotateCcw className="size-4" aria-hidden />
                    {tCommon('retry')}
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col lg:px-1.5 lg:pt-1" onKeyDown={onListKeyDown}>
            {/* Строка «Архив» — над списком «Все», как в Telegram. */}
            {!showArchive && folder === 'folderAll' && archivedChats.length > 0 && (
              <ChatListArchiveRow chats={archivedChats} onOpen={() => setArchiveOpen(true)} />
            )}
            {visibleChats.length === 0 ? (
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
              visibleChats.map((c) => (
                <ChatListRow
                  key={c.id}
                  chat={c}
                  active={activeId === c.id}
                  menuOpen={rowMenu?.id === c.id}
                  myId={myId}
                  locale={locale}
                  // «Печатает» вытесняет превью: пока собеседник набирает, это и есть самое
                  // свежее в чате. Имени в строке нет — места на него нет.
                  actionLabel={actionLabelOf(summarizeActors(actionsByChat[c.id]))}
                  rowRef={registerRow(c.id)}
                  buttonRef={(el) => {
                    if (el) rowElsRef.current.set(c.id, el)
                    else rowElsRef.current.delete(c.id)
                  }}
                  handlers={{
                    onOpen: () => {
                      if (swipedFlagRef.current) {
                        swipedFlagRef.current = false
                        return
                      }
                      if (swiped) {
                        onCloseSwiped(swiped.id)
                        return
                      }
                      openRow(c)
                    },
                    onContextMenu: (e) => openRowMenu(e, c.id),
                    onTouchStart: (e) => onRowTouchStart(e, c.id),
                    onTouchMove: onRowTouchMove,
                    onTouchEnd: (e) => onRowTouchEnd(e, c.id),
                    onToggleRead: () => {
                      toggleRead(c)
                      onCloseSwiped(c.id)
                    },
                    onTogglePin: () => {
                      onTogglePin(c)
                      onCloseSwiped(c.id)
                    },
                    onToggleMute: () => {
                      onToggleMute(c)
                      onCloseSwiped(c.id)
                    },
                    onToggleArchive: () => {
                      onToggleArchive(c)
                      onCloseSwiped(c.id)
                    },
                    onDelete: () => {
                      onCloseSwiped(c.id)
                      onDeleteChat(c)
                    },
                    onClearHistory: () => {
                      onCloseSwiped(c.id)
                      onClearHistory(c)
                    },
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>

      {tabMenu && (
        <RowContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          ariaLabel={t('foldersTitle')}
          onClose={() => setTabMenu(null)}
          items={[
            // «Прочитать все» — у любой вкладки, где есть что читать (Telegram-стиль).
            ...(tabMenuUnreadIds.length > 0
              ? [
                  {
                    key: 'folder-read-all',
                    icon: CheckCheck,
                    label: t('tgList.readAll'),
                    onClick: () => listActions.readAll(tabMenuUnreadIds),
                  },
                ]
              : []),
            ...(menuFolder
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
                ]),
          ]}
        />
      )}

      {rowMenu && menuChat && (
        <RowContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          anchor={rowMenu.anchor}
          ariaLabel={t('chatActions')}
          onClose={() => setRowMenu(null)}
          items={rowMenuItems(menuChat)}
        />
      )}
      <ChatListFab
        hidden={searchExpanded || showArchive}
        peek={peek || focusIn}
        embedded={embedded}
        onNewMessage={openSearch}
        onNewGroup={onNewGroup}
      />
    </aside>
  )
}

/** Системное «назад» (Android, жест iOS) закрывает экран архива, а не уводит со страницы. */
function ArchiveBackClose({ onClose }: { onClose: () => void }) {
  useBackClose(onClose)
  return null
}
