'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Download,
  Forward,
  Loader2,
  Ban,
  Eraser,
  MoreVertical,
  Pin,
  PinOff,
  Search,
  Trash2,
  UserSearch,
  WifiOff,
  X,
} from 'lucide-react'
import type { CreateChatPollInput } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { useRealtimeSocket, useRealtimeEvent } from '../../../shared/realtime'
import {
  chatKeys,
  exportChatRequest,
  fetchChats,
  fetchSavedChat,
  createChatPoll,
  fetchMessages,
  fetchPinned,
  fetchPresence,
  fetchChatMembers,
  fetchReadReceipts,
  saveChatDraft,
  forwardMessageRequest,
  pinMessageRequest,
  searchMessages,
  sendMessageWithAttachments,
  setChatMutedRequest,
  setChatPinnedRequest,
  blockUserRequest,
  unblockUserRequest,
  clearChatRequest,
  deleteChatRequest,
  toggleReactionRequest,
  unpinMessageRequest,
  AttachmentDialog,
  ForwardDialog,
  MessageContextMenu,
  fetchChatUpdates,
  fetchChatFolders,
  createChatFolderRequest,
  updateChatFolderRequest,
  deleteChatFolderRequest,
  useVoiceRecorder,
  type ChatFolder,
  type ChatListItem,
  type ChatMemberInfo,
  type ChatMessage,
  type MessageAttachment,
} from '../../../entities/chat'
import { latestSeqOf, mergeUpdates } from '../lib/merge-updates'
import { PeerInfoCard } from './peer-info-card'
import { ChatDetailsPanel } from './chat-details-panel'
import { ChatFoldersDialog } from './chat-folders-dialog'
import { MessageItem, type MessageActions, type MessageReadState } from './message-item'
import { ChatComposer } from './chat-composer'
import { PollCreator } from './poll-creator'
import { BlockedUsersDialog } from './blocked-users-dialog'
import { CreateGroupDialog } from './create-group-dialog'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DateJumpPicker,
  formatYmd,
  Modal,
  useConfirm,
} from '../../../shared/ui'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import { cn } from '../../../shared/lib/utils'
import { useChatListSlot, useMediaQuery, useSetChatOpen } from '../../../shared/lib'

import { ConversationList } from './conversation-list'
import { avatarColor, chatInitials, chatTitle, senderName } from '../lib/format'

export function ChatWindow() {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const socket = useRealtimeSocket()
  const me = useAppSelector((s) => s.auth.user)
  const myId = me?.id
  const confirm = useConfirm()
  // #1: состояние оптимистичных сообщений по temp-id (`tmp:<nonce>`) + таймеры «не пришло эхо».
  const [sendState, setSendState] = useState<Record<string, 'pending' | 'failed'>>({})
  const sendTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Десктоп: список чатов порталим в слот сайдбара (см. AppSidebar chatsMode).
  // На мобильном слота нет — список остаётся во весь экран внутри main.
  const listSlot = useChatListSlot()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // Достаточно широкий экран (≥xl) — правая панель деталей докается третьей колонкой,
  // не закрывая переписку (Telegram-стиль §1). На узких экранах — прежнее модальное окно.
  const isWide = useMediaQuery('(min-width: 1280px)')
  const embedded = isDesktop && !!listSlot
  // Открытый чат — полноэкранная поверхность на мобильном: просим оболочку скрыть нижнюю навигацию,
  // иначе фиксированная панель перекрывает поле ввода сообщения.
  const setChatOpen = useSetChatOpen()

  const [newChatOpen, setNewChatOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Открытие конкретного чата извне через ?chat=<id> (например кнопка «Написать» из профиля).
  const searchParams = useSearchParams()
  const requestedChatId = searchParams.get('chat')
  const appliedChatParam = useRef<string | null>(null)
  useEffect(() => {
    if (requestedChatId && requestedChatId !== appliedChatParam.current) {
      appliedChatParam.current = requestedChatId
      setActiveId(requestedChatId)
      // Чат мог быть только что создан («Написать» из профиля) — обновляем список, чтобы
      // шапка сразу показала имя собеседника (заголовок берётся из элемента списка).
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    }
  }, [requestedChatId, qc])
  // Deeplink на конкретное сообщение (#10): /chats?c=<chatId>&m=<messageId> (кнопка «Копировать ссылку»).
  // Открываем чат c, затем после загрузки истории прыгаем к сообщению m (эффект — ниже, после messages).
  const deepChatId = searchParams.get('c')
  const deepMsgId = searchParams.get('m')
  const appliedDeeplink = useRef<string | null>(null)
  // Черновики по чатам: локально (мгновенно) + синхронизация с сервером (#3, дебаунс).
  const draftsRef = useRef<Map<string, string>>(new Map())
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [text, setText] = useState('')
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({})
  const [connected, setConnected] = useState(true)
  // Момент, до которого мы точно получали события, — граница для правок и удалений при догоне.
  // Обновляется при обрыве связи; начальное значение покрывает случай connect без предшествующего
  // disconnect (перехват лидерства мастер-вкладки).
  const lastSyncAt = useRef(new Date().toISOString())
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined)
  const [canLoadOlder, setCanLoadOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Курсор более НОВЫХ сообщений: не-undefined только после jump в «прыгнутое» окно (around),
  // когда снизу есть неподгруженные сообщения (Этап 1, двунаправленная пагинация).
  const [newerCursor, setNewerCursor] = useState<string | undefined>(undefined)
  const [canLoadNewer, setCanLoadNewer] = useState(false)
  const loadingNewerRef = useRef(false)
  // Ф9+: ответ, вложения, поиск.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  // Прикрепление файлов через диалог «Отправить как файл» (Telegram-стиль).
  const [attachFiles, setAttachFiles] = useState<File[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  // Создание опроса (§38) — диалог из attachment-меню композера.
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false)
  // Единый поиск в панели чатов: по названиям чатов + по сообщениям (глобально).
  const [listSearchRaw, setListSearchRaw] = useState('')
  const [listSearchTerm, setListSearchTerm] = useState('')
  const [pinnedIndex, setPinnedIndex] = useState(0)
  const [pinnedTouched, setPinnedTouched] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Время, до которого другие участники прочитали чат — для статусов ✓/✓✓ своих сообщений.
  const [readWatermark, setReadWatermark] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null)
  const [presence, setPresence] = useState<Record<string, boolean>>({})
  // Telegram-стиль: контекстное меню сообщения и режим правки.
  const [menu, setMenu] = useState<{ message: ChatMessage; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  // Поиск внутри активного чата (Telegram-стиль §3): режим в шапке + навигация по совпадениям.
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  // Дата перехода по истории: хранится, чтобы поле показывало выбранное значение, а не
  // возвращалось к плейсхолдеру — иначе непонятно, к какому дню прокручен чат.
  const [jumpDate, setJumpDate] = useState('')
  const [chatSearchRaw, setChatSearchRaw] = useState('')
  const [chatSearchTerm, setChatSearchTerm] = useState('')
  const [searchIdx, setSearchIdx] = useState(0)
  const searchJumpedFor = useRef<string | null>(null)
  // Фильтр «От кого» (§4): id+имя выбранного автора (или null — все).
  const [searchFrom, setSearchFrom] = useState<{ id: string; name: string } | null>(null)
  const [searchFromOpen, setSearchFromOpen] = useState(false)
  // Мини-карточка собеседника (личный чат, Telegram-стиль) — по клику на шапку.
  const [peerCardOpen, setPeerCardOpen] = useState(false)
  // Докнутая правая панель деталей (десктоп ≥xl): профиль/участники/медиа без ухода из чата.
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Кнопка «вниз» + счётчик сообщений, пришедших пока пользователь пролистан вверх (Telegram-стиль).
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [newSinceScroll, setNewSinceScroll] = useState(0)
  // Плавающий заголовок даты (Telegram-стиль §6): дата верхнего видимого сообщения, гаснет вне скролла.
  const [floatingDay, setFloatingDay] = useState<string | null>(null)
  const [floatingDayShown, setFloatingDayShown] = useState(false)
  const floatingHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Режим множественного выбора сообщений (Telegram-стиль): чекбоксы + массовые действия.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Пересылка нескольких выбранных сообщений (id) — переиспользуем ForwardDialog.
  const [forwardIds, setForwardIds] = useState<string[] | null>(null)
  // Свайп-действия на строке списка чатов (мобильный): id открытой строки + учёт жеста.
  // Открытая свайпом строка + сторона: 'left' — панель «Прочитать/Закрепить» (свайп вправо),
  // 'right' — панель «Без звука/Удалить» (свайп влево).
  const [swiped, setSwiped] = useState<{ id: string; side: 'left' | 'right' } | null>(null)
  const chatSwipe = useRef<{
    id: string
    startX: number
    startY: number
    moved: boolean
    el: HTMLElement
    base: number
  } | null>(null)
  const chatSwipedFlag = useRef(false)
  // Узлы строк списка (по id) — чтобы императивно доводить/сбрасывать свайп и закрывать соседние.
  const rowEls = useRef<Map<string, HTMLElement>>(new Map())
  // Разделитель «Непрочитанные»: снимок кол-ва непрочитанных при открытии + id первого непрочитанного.
  const [openUnread, setOpenUnread] = useState(0)
  const [unreadDividerId, setUnreadDividerId] = useState<string | null>(null)
  const chatsRef = useRef<ChatListItem[] | undefined>(undefined)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  // Виртуализатор списка сообщений (virtua): императивный скролл к индексу (вниз/к сообщению).
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  // shift=true на время подгрузки старых сообщений (prepend вверх) — virtua сохраняет визуальную
  // позицию «от конца», без прыжка. Для входящих (append в конец) shift обязан быть false.
  const [shiftMode, setShiftMode] = useState(false)
  // Для какого чата уже выполнен первичный скролл вниз (открытие ≠ новое сообщение).
  const scrolledForRef = useRef<string | null>(null)
  // id последнего сообщения — чтобы отличать «добавилось новое» от prepend старых / update.
  const lastMsgIdRef = useRef<string | null>(null)
  // Реэнтри-гард авто-догрузки старых при скролле вверх.
  const loadingOlderRef = useRef(false)
  // Был ли пользователь у нижнего края при прошлом событии скролла (для отметки прочтения по факту).
  const wasAtBottomRef = useRef(true)
  const typingSentAt = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  // Автодополнение @-упоминаний: активный запрос после @ (null — попап скрыт).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)

  const chats = useQuery({ queryKey: chatKeys.list(), queryFn: fetchChats })
  // Держим свежий список в ref — чтобы снять снимок непрочитанных РОВНО при открытии чата (до инвалидации).
  chatsRef.current = chats.data

  const messages = useQuery({
    queryKey: chatKeys.messages(activeId ?? ''),
    queryFn: async () => {
      const page = await fetchMessages(activeId as string, { limit: 30 })
      setOlderCursor(page.cursor)
      setCanLoadOlder(page.hasNext)
      // Первичная загрузка — у низа истории: более новых нет.
      setNewerCursor(undefined)
      setCanLoadNewer(false)
      // API отдаёт новые первыми — разворачиваем в хронологический порядок.
      return [...page.items].reverse()
    },
    enabled: !!activeId,
  })

  // Deeplink на сообщение (#10): открыть чат c, затем — когда история загружена — прыгнуть к m.
  useEffect(() => {
    if (!deepChatId) return
    const key = `${deepChatId}:${deepMsgId ?? ''}`
    if (appliedDeeplink.current === key) return
    if (activeId !== deepChatId) {
      setActiveId(deepChatId)
      return
    }
    if (deepMsgId) {
      if (!messages.isSuccess) return
      appliedDeeplink.current = key
      void jumpToMessage(deepMsgId)
    } else {
      appliedDeeplink.current = key
    }
  }, [deepChatId, deepMsgId, activeId, messages.isSuccess, jumpToMessage])

  const pinned = useQuery({
    queryKey: chatKeys.pinned(activeId ?? ''),
    queryFn: () => fetchPinned(activeId as string),
    enabled: !!activeId,
  })

  // Дебаунс единого поиска панели (350мс) + глобальный поиск по сообщениям.
  useEffect(() => {
    const term = listSearchRaw.trim()
    const id = setTimeout(() => setListSearchTerm(term.length >= 2 ? term : ''), 350)
    return () => clearTimeout(id)
  }, [listSearchRaw])

  const listMsgResults = useQuery({
    queryKey: chatKeys.search(listSearchTerm, undefined),
    queryFn: () => searchMessages(listSearchTerm),
    enabled: listSearchTerm.length >= 2,
  })

  // Поиск внутри чата (§3): дебаунс запроса + результаты по активному чату.
  useEffect(() => {
    const term = chatSearchRaw.trim()
    const id = setTimeout(() => setChatSearchTerm(term.length >= 2 ? term : ''), 300)
    return () => clearTimeout(id)
  }, [chatSearchRaw])
  const chatSearchResults = useQuery({
    queryKey: [...chatKeys.search(chatSearchTerm, activeId ?? undefined), searchFrom?.id ?? 'any'],
    queryFn: () =>
      searchMessages(chatSearchTerm, activeId as string, undefined, { senderId: searchFrom?.id }),
    enabled: chatSearchOpen && !!activeId && chatSearchTerm.length >= 2,
  })

  // Явно pin/unpin по флагу (не полагаемся на возможно-устаревший pinnedAt) + обновляем кэш из ответа.
  const setPin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? pinMessageRequest(id) : unpinMessageRequest(id),
    onSuccess: (updated) => {
      if (!activeId) return
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), (old) =>
        (old ?? []).map((m) => (m.id === updated.id ? updated : m)),
      )
      void qc.invalidateQueries({ queryKey: chatKeys.pinned(activeId) })
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const react = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      toggleReactionRequest(messageId, emoji),
    // Оптимистично тоггл своей реакции — видно сразу; серверное эхо message:reaction подтвердит/поправит.
    onMutate: ({ messageId, emoji }) => {
      if (!me || !activeId) return { prev: undefined }
      const prev = qc.getQueryData<ChatMessage[]>(chatKeys.messages(activeId))
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), (old) =>
        (old ?? []).map((m) => {
          if (m.id !== messageId) return m
          const has = m.reactions.some((r) => r.userId === me.id && r.emoji === emoji)
          const reactions = has
            ? m.reactions.filter((r) => !(r.userId === me.id && r.emoji === emoji))
            : [
                ...m.reactions,
                {
                  emoji,
                  userId: me.id,
                  user: {
                    id: me.id,
                    firstName: me.firstName,
                    lastName: me.lastName,
                    avatarUrl: me.avatarUrl,
                  },
                },
              ]
          return { ...m, reactions }
        }),
      )
      return { prev }
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev && activeId) qc.setQueryData(chatKeys.messages(activeId), ctx.prev)
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    },
  })

  const forward = useMutation({
    mutationFn: ({ targetChatId, messageId }: { targetChatId: string; messageId: string }) =>
      forwardMessageRequest(targetChatId, messageId),
    onSuccess: () => {
      setForwardMsg(null)
      toast.success(t('forwarded'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Создание опроса (§38): сообщение-опрос придёт по WS message:new — оптимистично не добавляем.
  const createPoll = useMutation({
    mutationFn: (input: CreateChatPollInput) => createChatPoll(activeId as string, input),
    onSuccess: () => setPollCreatorOpen(false),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Пользовательские папки чатов (§2): вкладки списка. Держим здесь, потому что список чатов
  // порталится в сайдбар и своего состояния не имеет.
  const [foldersOpen, setFoldersOpen] = useState(false)
  const folders = useQuery({ queryKey: chatKeys.folders(), queryFn: fetchChatFolders })
  const folderList: ChatFolder[] = folders.data ?? []

  const folderError = (e: unknown) =>
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidateFolders = () => void qc.invalidateQueries({ queryKey: chatKeys.folders() })

  const createFolder = useMutation({
    mutationFn: createChatFolderRequest,
    onSuccess: invalidateFolders,
    onError: folderError,
  })
  const updateFolder = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; chatIds?: string[] }) =>
      updateChatFolderRequest(id, input),
    onSuccess: invalidateFolders,
    onError: folderError,
  })
  const deleteFolder = useMutation({
    mutationFn: deleteChatFolderRequest,
    onSuccess: invalidateFolders,
    onError: folderError,
  })

  const mute = useMutation({
    mutationFn: ({
      chatId,
      muted,
      minutes,
      importantOnly,
    }: {
      chatId: string
      muted: boolean
      minutes?: number
      importantOnly?: boolean
    }) => setChatMutedRequest(chatId, muted, minutes, importantOnly),
    // Оптимистично переключаем флаг в кэше списка — мгновенная обратная связь в UI.
    onMutate: ({ chatId, muted, importantOnly }) => {
      const prev = qc.getQueryData<ChatListItem[]>(chatKeys.list())
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        (old ?? []).map((c) =>
          c.id === chatId
            ? { ...c, muted, mutedImportantOnly: muted ? (importantOnly ?? false) : false }
            : c,
        ),
      )
      return { prev }
    },
    onSuccess: (_data, { muted }) => toast.success(muted ? t('mutedDone') : t('unmutedDone')),
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatKeys.list(), ctx.prev)
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: chatKeys.list() }),
  })

  // Закрепление чата «у себя» (Telegram-стиль): оптимистично ставим флаг и поднимаем закреплённые наверх.
  const pin = useMutation({
    mutationFn: ({ chatId, pinned }: { chatId: string; pinned: boolean }) =>
      setChatPinnedRequest(chatId, pinned),
    onMutate: ({ chatId, pinned }) => {
      const prev = qc.getQueryData<ChatListItem[]>(chatKeys.list())
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) => {
        const list = (old ?? []).map((c) => (c.id === chatId ? { ...c, pinned } : c))
        // Закреплённые — сверху; порядок внутри групп сохраняем (Array.sort стабилен).
        return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned))
      })
      return { prev }
    },
    onSuccess: (_data, { pinned }) => toast.success(pinned ? t('pinnedDone') : t('unpinnedDone')),
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatKeys.list(), ctx.prev)
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: chatKeys.list() }),
  })

  // Личная блокировка собеседника в PRIVATE-чате.
  const block = useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      blocked ? unblockUserRequest(userId) : blockUserRequest(userId),
    onSuccess: (_data, { blocked }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(blocked ? t('userUnblocked') : t('userBlocked'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const clearChat = useMutation({
    mutationFn: (chatId: string) => clearChatRequest(chatId),
    onSuccess: (_d, chatId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('historyCleared'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => deleteChatRequest(chatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      setActiveId(null)
      toast.success(t('chatDeleted'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const exportChat = useMutation({
    mutationFn: async (format: 'txt' | 'json') => {
      const items = await exportChatRequest(activeId as string)
      const title = activeChat ? chatTitle(activeChat, t) : activeId
      const body =
        format === 'json'
          ? JSON.stringify(items, null, 2)
          : items
              .map(
                (m) =>
                  `[${new Date(m.createdAt).toLocaleString(locale)}] ${senderName(m)}: ${
                    m.content || (m.media.length ? `[${t('attachment')}]` : '')
                  }`,
              )
              .join('\n')
      const blob = new Blob([body], {
        type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chat-${title}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const presenceQuery = useQuery({
    queryKey: chatKeys.presence(activeId ?? ''),
    queryFn: () => fetchPresence(activeId as string),
    enabled: !!activeId,
  })

  // Участники активного чата — для @-упоминаний.
  const membersQuery = useQuery({
    queryKey: chatKeys.members(activeId ?? ''),
    queryFn: () => fetchChatMembers(activeId as string),
    enabled: !!activeId,
  })
  // #6: статусы прочтения участниками (кто прочитал) — для счётчика «прочитали N» у своих сообщений.
  const readsQuery = useQuery({
    queryKey: chatKeys.reads(activeId ?? ''),
    queryFn: () => fetchReadReceipts(activeId as string),
    enabled: !!activeId,
  })
  useEffect(() => {
    if (presenceQuery.data) {
      setPresence(Object.fromEntries(presenceQuery.data.map((p) => [p.userId, p.online])))
    }
  }, [presenceQuery.data])

  // Инициализация watermark прочтения при смене активного чата (из списка чатов).
  useEffect(() => {
    const chat = chats.data?.find((c) => c.id === activeId)
    setReadWatermark(chat?.othersReadAt ?? null)
  }, [activeId, chats.data])

  // Запись голосового: по завершению отправляем сразу как вложение (Telegram-стиль).
  const voice = useVoiceRecorder({
    onRecorded: (file) => {
      if (!activeId) return
      sendFiles({ replyToId: replyTo?.id, files: [file] })
    },
    onError: (kind) =>
      toast.error(t(kind === 'unsupported' ? 'recordUnsupported' : 'recordDenied')),
  })

  // ── Оптимистичная отправка медиа (Telegram-стиль) ─────────────────────────────
  // Пузырь нужного типа (голос/видео/фото/файл) с локальным превью показываем сразу, ещё до
  // ответа сервера; поверх — оверлей прогресса загрузки. Реальное сообщение подменяет пузырь по
  // эхо message:new. У HTTP-вложений нет nonce (в отличие от текста) — примиряем по сигнатуре медиа
  // (набор размеров) с FIFO-фолбэком. localUrl переносим на реальное сообщение, чтобы не перезагружать
  // медиа с сервера (без «мигания»).
  const pendingMedia = useRef<
    { tempId: string; chatId: string; sig: string; localUrls: string[] }[]
  >([])
  const createdObjectUrls = useRef<string[]>([])
  const mediaRetry = useRef<
    Map<
      string,
      { chatId: string; content?: string; replyToId?: string; files: File[]; spoiler?: boolean }
    >
  >(new Map())

  // Освобождаем object-URL'ы при размонтировании окна чата (в течение сессии держим живыми —
  // они переиспользуются реальными сообщениями для мгновенного показа без запроса к серверу).
  useEffect(
    () => () => {
      createdObjectUrls.current.forEach((u) => URL.revokeObjectURL(u))
      createdObjectUrls.current = []
    },
    [],
  )

  function mediaSig(items: { size: number }[]): string {
    return items
      .map((a) => a.size)
      .sort((x, y) => x - y)
      .join(',')
  }

  // Обновить прогресс загрузки у всех вложений оптимистичного пузыря.
  function setUploadProgress(chatId: string, tempId: string, fraction: number): void {
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
      (old ?? []).map((m) =>
        m.id === tempId ? { ...m, media: m.media.map((a) => ({ ...a, progress: fraction })) } : m,
      ),
    )
  }

  // Заменить оптимистичный пузырь реальным сообщением; localUrl переносим вперёд (без перезагрузки медиа).
  function replaceOptimisticMedia(
    chatId: string,
    tempId: string,
    real: ChatMessage,
    localUrls: string[],
  ): void {
    const realWithLocal: ChatMessage = {
      ...real,
      media: real.media.map((a, i) => ({ ...a, localUrl: localUrls[i] })),
    }
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) => {
      const list = old ?? []
      const withoutReal = list.filter((m) => m.id !== real.id) // эхо могло уже добавить реальное — убираем дубль
      const idx = withoutReal.findIndex((m) => m.id === tempId)
      if (idx === -1) return list.some((m) => m.id === real.id) ? list : [...list, realWithLocal]
      const copy = withoutReal.slice()
      copy[idx] = realWithLocal
      return copy
    })
  }

  // Снять оптимистичный пузырь из очереди ожидания по эхо message:new (по сигнатуре, иначе FIFO).
  function takePendingMedia(
    chatId: string,
    real: ChatMessage,
  ): { tempId: string; localUrls: string[] } | null {
    const arr = pendingMedia.current
    const sig = mediaSig(real.media)
    let idx = arr.findIndex((p) => p.chatId === chatId && p.sig === sig)
    if (idx === -1) idx = arr.findIndex((p) => p.chatId === chatId)
    if (idx === -1) return null
    const taken = arr.splice(idx, 1)[0]
    if (!taken) return null
    return { tempId: taken.tempId, localUrls: taken.localUrls }
  }

  async function uploadFiles(
    tempId: string,
    chatId: string,
    content: string | undefined,
    replyToId: string | undefined,
    files: File[],
    spoiler?: boolean,
  ): Promise<void> {
    setSendState((s) => ({ ...s, [tempId]: 'pending' }))
    try {
      const real = await sendMessageWithAttachments(
        chatId,
        { content, replyToId, spoiler },
        files,
        (f) => setUploadProgress(chatId, tempId, f),
      )
      mediaRetry.current.delete(tempId)
      // Обычно примиряет эхо message:new; страховка на случай гонки/фонового чата.
      const stillPending = pendingMedia.current.find((p) => p.tempId === tempId)
      if (stillPending) {
        pendingMedia.current = pendingMedia.current.filter((p) => p.tempId !== tempId)
        replaceOptimisticMedia(chatId, tempId, real, stillPending.localUrls)
        setSendState((s) => {
          const next = { ...s }
          delete next[tempId]
          return next
        })
      }
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    } catch (e) {
      // Загрузка не удалась — помечаем пузырь ошибкой, оставляем для повтора (клик по значку).
      pendingMedia.current = pendingMedia.current.filter((p) => p.tempId !== tempId)
      setSendState((s) => ({ ...s, [tempId]: 'failed' }))
      setUploadProgress(chatId, tempId, 0)
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    }
  }

  function sendFiles(payload: {
    content?: string
    replyToId?: string
    files: File[]
    spoiler?: boolean
  }): void {
    if (!activeId || !me || payload.files.length === 0) return
    const chatId = activeId
    const nonce =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    const tempId = `tmp:${nonce}`
    const localUrls = payload.files.map((f) => URL.createObjectURL(f))
    createdObjectUrls.current.push(...localUrls)
    const media: MessageAttachment[] = payload.files.map((f, i) => ({
      id: `${tempId}:${i}`,
      mime: f.type || 'application/octet-stream',
      size: f.size,
      name: f.name,
      spoiler: payload.spoiler,
      localUrl: localUrls[i],
      uploading: true,
      progress: 0,
    }))
    const temp: ChatMessage = {
      id: tempId,
      chatId,
      // Серверного номера у оптимистичного пузыря ещё нет; 0 не участвует в расчёте точки догона.
      seq: 0,
      senderId: me.id,
      content: payload.content ?? '',
      replyToId: payload.replyToId ?? null,
      forwardedFromId: null,
      editedAt: null,
      pinnedAt: null,
      createdAt: new Date().toISOString(),
      sender: {
        id: me.id,
        firstName: me.firstName,
        lastName: me.lastName,
        avatarUrl: me.avatarUrl,
      },
      linkPreview: null,
      media,
      // Оптимистичная цитата ответа для медиа-сообщения (вложенный блок виден сразу).
      replyTo:
        replyTo && replyTo.id === payload.replyToId
          ? {
              id: replyTo.id,
              content: replyTo.content,
              senderId: replyTo.senderId,
              sender: replyTo.sender,
            }
          : null,
      forwardedFrom: null,
      sharedPost: null,
      reactions: [],
      poll: null,
      systemType: null,
      systemMeta: null,
    }
    pendingMedia.current.push({ tempId, chatId, sig: mediaSig(media), localUrls })
    mediaRetry.current.set(tempId, {
      chatId,
      content: payload.content,
      replyToId: payload.replyToId,
      files: payload.files,
      spoiler: payload.spoiler,
    })
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) => [...(old ?? []), temp])
    // Сбрасываем композер/диалог сразу — как в Telegram (пузырь уже в ленте, грузится в фоне).
    setText('')
    setAttachFiles([])
    setAttachOpen(false)
    setReplyTo(null)
    void uploadFiles(
      tempId,
      chatId,
      payload.content,
      payload.replyToId,
      payload.files,
      payload.spoiler,
    )
  }

  // Вход/выход из комнаты чата при смене активного чата.
  useEffect(() => {
    if (!socket || !activeId) return
    socket.emit('chat:join', { chatId: activeId })
    setReplyTo(null)
    setAttachFiles([])
    setAttachOpen(false)
    setPinnedIndex(0)
    setPinnedTouched(false)
    return () => {
      socket.emit('chat:leave', { chatId: activeId })
    }
  }, [socket, activeId])

  // Индикатор связи + догон пропущенного и повторный вход в комнату при реконнекте.
  useEffect(() => {
    if (!socket) return
    setConnected(socket.connected)

    // Пока связи не было, события никто не переприсылает. Вместо перезапроса страницы истории
    // забираем ровно разницу с последнего известного seq (docs/PROJECT.md §9). Полный рефетч
    // остаётся фолбэком: разрыв больше серверного лимита, пустой кэш или ошибка запроса.
    const catchUp = async (chatId: string): Promise<void> => {
      const cached = qc.getQueryData<ChatMessage[]>(chatKeys.messages(chatId))
      const since = latestSeqOf(cached)
      if (!since) {
        void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
        return
      }
      try {
        const delta = await fetchChatUpdates(chatId, since, lastSyncAt.current)
        if (delta.overflow) {
          void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
        } else {
          qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
            mergeUpdates(old, delta),
          )
        }
        lastSyncAt.current = new Date().toISOString()
      } catch {
        void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
      }
    }

    const onConnect = (): void => {
      setConnected(true)
      if (activeId) {
        socket.emit('chat:join', { chatId: activeId })
        void catchUp(activeId)
      }
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    }
    const onDisconnect = (): void => {
      setConnected(false)
      // До этого момента события приходили — с него и запрашиваем правки при догоне.
      lastSyncAt.current = new Date().toISOString()
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [socket, activeId, qc])

  // Входящие события — синхронизируем с кэшем React Query (docs/FRONTEND_RULES.md §8).
  useRealtimeEvent<{ message: ChatMessage; chatId: string; nonce?: string }>(
    'message:new',
    ({ message, chatId, nonce }) => {
      // #1: гасим таймер/статус оптимистичного пузыря по nonce (независимо от активного чата).
      if (nonce) {
        const timer = sendTimers.current.get(nonce)
        if (timer) {
          clearTimeout(timer)
          sendTimers.current.delete(nonce)
        }
        setSendState((s) => {
          if (!(`tmp:${nonce}` in s)) return s
          const next = { ...s }
          delete next[`tmp:${nonce}`]
          return next
        })
      }
      // Оптимистичное медиа: у HTTP-вложений нет nonce — примиряем свой пузырь по сигнатуре/FIFO,
      // независимо от активного чата (реальное сообщение подменяет пузырь в кэше своего chatId).
      if (!nonce && message.senderId === myId && message.media.length > 0) {
        const taken = takePendingMedia(chatId, message)
        if (taken) {
          replaceOptimisticMedia(chatId, taken.tempId, message, taken.localUrls)
          mediaRetry.current.delete(taken.tempId)
          setSendState((s) => {
            if (!(taken.tempId in s)) return s
            const next = { ...s }
            delete next[taken.tempId]
            return next
          })
          void qc.invalidateQueries({ queryKey: chatKeys.list() })
          return
        }
      }
      if (chatId === activeId) {
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) => {
          const listOld = old ?? []
          // Заменяем свой оптимистичный пузырь реальным сообщением (по nonce), иначе добавляем.
          if (nonce) {
            const idx = listOld.findIndex((m) => m.id === `tmp:${nonce}`)
            if (idx !== -1) {
              const copy = listOld.slice()
              copy[idx] = message
              return copy
            }
          }
          return listOld.some((m) => m.id === message.id) ? listOld : [...listOld, message]
        })
      }
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    },
  )
  // Сообщения в НЕактивные чаты приходят в комнату chat:{id}, куда мы не входим; но их уведомление
  // прилетает в комнату user:{id} — по нему обновляем список чатов в реальном времени (превью, счётчик, порядок).
  useRealtimeEvent('notification:new', () => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  })
  // Тихий сигнал активности в чате (в т.ч. по заглушённым чатам): держим список живым без уведомления.
  // Опрос обновился (кто-то проголосовал) — инвалидируем его результаты (§39, live).
  useRealtimeEvent('poll:updated', (p: { pollId: string }) => {
    void qc.invalidateQueries({ queryKey: chatKeys.poll(p.pollId) })
  })
  useRealtimeEvent('chat:activity', () => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  })
  // Блокировка изменилась (я/меня) — обновляем список: флаги blocked/blockedBy определяют поле ввода
  // и баннер у обоих участников в реальном времени.
  useRealtimeEvent('chat:block', () => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  })
  // Закрепление изменилось — сигнал приходит всем участникам (в т.ч. с закрытым чатом): инвалидируем
  // закреплённые и сообщения этого чата, чтобы при открытии закрепление уже подтянулось.
  useRealtimeEvent<{ chatId: string }>('chat:pinned', ({ chatId }) => {
    void qc.invalidateQueries({ queryKey: chatKeys.pinned(chatId) })
    void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
  })
  // Метаданные чата изменились (название/аватар, 9.4): обновляем список и открытое окно.
  useRealtimeEvent<{ chatId: string }>('chat:updated', ({ chatId }) => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
    void qc.invalidateQueries({ queryKey: chatKeys.members(chatId) })
  })
  // Состав участников изменился (9.4): обновляем список чатов и участников открытого окна.
  const onMembersChanged = ({ chatId }: { chatId: string }): void => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
    void qc.invalidateQueries({ queryKey: chatKeys.members(chatId) })
  }
  useRealtimeEvent<{ chatId: string }>('chat:member-added', onMembersChanged)
  useRealtimeEvent<{ chatId: string }>('chat:member-removed', onMembersChanged)
  const upsert = (message: ChatMessage, chatId: string): void => {
    if (chatId === activeId) {
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
        (old ?? []).map((m) => (m.id === message.id ? message : m)),
      )
      void qc.invalidateQueries({ queryKey: chatKeys.pinned(chatId) })
    }
  }
  useRealtimeEvent<{ message: ChatMessage; chatId: string }>(
    'message:updated',
    ({ message, chatId }) => {
      upsert(message, chatId)
      // Правка последнего сообщения меняет превью в списке.
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    },
  )
  useRealtimeEvent<{ message: ChatMessage; chatId: string }>(
    'message:pinned',
    ({ message, chatId }) => upsert(message, chatId),
  )
  useRealtimeEvent<{ message: ChatMessage; chatId: string }>(
    'message:unpinned',
    ({ message, chatId }) => upsert(message, chatId),
  )
  useRealtimeEvent<{ message: ChatMessage; chatId: string }>(
    'message:reaction',
    ({ message, chatId }) => upsert(message, chatId),
  )
  useRealtimeEvent<{ userId: string; online: boolean }>(
    'presence:changed',
    ({ userId, online }) => {
      setPresence((prev) => (prev[userId] === online ? prev : { ...prev, [userId]: online }))
    },
  )
  // Прочтение другим участником — двигаем watermark активного чата вперёд (статус ✓✓ у своих сообщений)
  // + обновляем список чатов, чтобы статус доставки в превью тоже был живым.
  useRealtimeEvent<{ chatId: string; userId: string; readAt: string }>(
    'message:read',
    ({ chatId, userId, readAt }) => {
      if (userId === myId) return
      if (chatId === activeId) {
        setReadWatermark((prev) => (!prev || readAt > prev ? readAt : prev))
        // #6: обновляем «кто прочитал» для счётчика у своих сообщений.
        void qc.invalidateQueries({ queryKey: chatKeys.reads(chatId) })
      }
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    },
  )
  useRealtimeEvent<{ messageId: string; chatId: string }>(
    'message:deleted',
    ({ messageId, chatId }) => {
      if (chatId === activeId) {
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
          (old ?? []).filter((m) => m.id !== messageId),
        )
      }
      // Удаление последнего сообщения меняет превью списка.
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    },
  )
  useRealtimeEvent<{ chatId: string; userId: string }>('typing:started', ({ chatId, userId }) => {
    if (chatId === activeId && userId !== myId) {
      setTypingUsers((prev) => ({ ...prev, [userId]: Date.now() }))
    }
  })
  useRealtimeEvent<{ chatId: string; userId: string }>('typing:stopped', ({ chatId, userId }) => {
    if (chatId === activeId) {
      setTypingUsers((prev) => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
    }
  })

  // Автоочистка «печатает» через 4с без обновления.
  useEffect(() => {
    const timer = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now()
        const next: Record<string, number> = {}
        for (const [uid, ts] of Object.entries(prev)) if (now - ts < 4000) next[uid] = ts
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  // Сообщаем оболочке, открыт ли чат (полноэкранный режим → скрыть нижнюю навигацию на мобильном).
  useEffect(() => {
    setChatOpen?.(!!activeId)
    return () => setChatOpen?.(false)
  }, [activeId, setChatOpen])

  // #3: гидрируем локальные черновики из серверных (при загрузке/обновлении списка), не затирая
  // уже набранное (ставим только если локального ещё нет). Дальше их подхватывает сид ниже.
  useEffect(() => {
    for (const c of chats.data ?? []) {
      if (c.draft && !draftsRef.current.has(c.id)) draftsRef.current.set(c.id, c.draft)
    }
  }, [chats.data])

  // Черновик: при переключении чата подставляем сохранённый текст (или пусто). Сбрасываем мультивыбор.
  useEffect(() => {
    setEditing(null)
    setText(activeId ? (draftsRef.current.get(activeId) ?? '') : '')
    setSelectMode(false)
    setSelectedIds(new Set())
    setPeerCardOpen(false)
  }, [activeId])

  // Снимок числа непрочитанных РОВНО при открытии чата (до отметки прочтения/инвалидации списка).
  useEffect(() => {
    const c = chatsRef.current?.find((x) => x.id === activeId)
    setOpenUnread(c?.unreadCount ?? 0)
    setUnreadDividerId(null)
  }, [activeId])

  // Как только сообщения загрузились — фиксируем id первого непрочитанного (последние openUnread в ленте).
  // Приблизительно: точную границу «моё последнее прочитанное» API пока не отдаёт (только unreadCount).
  useEffect(() => {
    if (unreadDividerId || openUnread <= 0 || !messages.data?.length) return
    const len = messages.data.length
    if (len < openUnread) return
    const target = messages.data[len - openUnread]
    if (target) setUnreadDividerId(target.id)
  }, [messages.data, openUnread, unreadDividerId])

  // Расстояние от низа < порога — пользователь «у низа» (auto-scroll и отметка прочтения уместны).
  function nearBottom(): boolean {
    const el = messagesScrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // Прокрутка вниз и отметка прочтения (Telegram-стиль). При ОТКРЫТИИ чата — мгновенно к низу
  // (контейнер перемонтирован, key={activeId}). Новое последнее сообщение: если пользователь у низа
  // или это своё — плавно вниз; иначе не дёргаем скролл, а копим счётчик и показываем кнопку «вниз».
  // Prepend старых и update существующих (id последнего не изменился) прокрутку не вызывают.
  useEffect(() => {
    if (!messages.data?.length || !activeId || !socket) return
    const list = messages.data
    const last = list[list.length - 1]
    const firstForChat = scrolledForRef.current !== activeId
    const prevLastId = lastMsgIdRef.current
    lastMsgIdRef.current = last?.id ?? null
    const toBottom = (behavior: ScrollBehavior): void => {
      const len = list.length
      if (len > 0)
        virtualizerRef.current?.scrollToIndex(len - 1, {
          align: 'end',
          smooth: behavior === 'smooth',
        })
    }

    if (firstForChat) {
      scrolledForRef.current = activeId
      setNewSinceScroll(0)
      setShowScrollDown(false)
      requestAnimationFrame(() => {
        toBottom('auto')
        window.setTimeout(() => toBottom('auto'), 120)
      })
      if (last) socket.emit('message:read', { chatId: activeId, messageId: last.id })
      return
    }

    if (last && last.id !== prevLastId) {
      if (last.senderId === myId || nearBottom()) {
        toBottom('smooth')
        socket.emit('message:read', { chatId: activeId, messageId: last.id })
      } else {
        setNewSinceScroll((n) => n + 1)
        setShowScrollDown(true)
      }
    }
  }, [messages.data, activeId, socket, myId])

  // Скролл ленты: показ кнопки «вниз», отметка прочтения при доскролле вниз, авто-догрузка старых у верха.
  function onMessagesScroll(): void {
    const el = messagesScrollRef.current
    if (!el) return
    // Плавающий заголовок даты (§6): дата верхнего видимого сообщения + авто-затухание вне скролла.
    const vh = virtualizerRef.current
    const data = messages.data
    if (vh && data && data.length > 0) {
      const topIdx = Math.min(Math.max(vh.findItemIndex(vh.scrollOffset), 0), data.length - 1)
      const top = data[topIdx]
      if (top) {
        setFloatingDay(dayLabel(top.createdAt))
        setFloatingDayShown(true)
        if (floatingHideTimer.current) clearTimeout(floatingHideTimer.current)
        floatingHideTimer.current = setTimeout(() => setFloatingDayShown(false), 1500)
      }
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setShowScrollDown(!atBottom)
    if (atBottom && !wasAtBottomRef.current) {
      setNewSinceScroll(0)
      const last = messages.data?.[messages.data.length - 1]
      if (last && socket && activeId)
        socket.emit('message:read', { chatId: activeId, messageId: last.id })
    }
    wasAtBottomRef.current = atBottom
    // Догрузка старых при подходе к верху — с сохранением визуальной позиции.
    if (el.scrollTop < 100 && canLoadOlder && !loadingOlderRef.current) {
      loadingOlderRef.current = true
      // virtua сам удержит визуальную позицию при prepend, пока shift=true — без ручной коррекции scrollTop.
      setShiftMode(true)
      void loadOlder().finally(() => {
        loadingOlderRef.current = false
        // Сбрасываем shift в следующем кадре, когда догруженные сообщения уже отрисованы.
        requestAnimationFrame(() => setShiftMode(false))
      })
    }
    // Догрузка новых при подходе к низу — актуально только в «прыгнутом» окне (после jump).
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight < 200 &&
      canLoadNewer &&
      !loadingNewerRef.current
    ) {
      void loadNewer()
    }
  }

  function scrollToBottom(): void {
    const id = activeId
    if (canLoadNewer && id) {
      // В «прыгнутом» окне последнее загруженное ≠ реальный низ — перезагружаем новейшие
      // (эффект первичного скролла проскроллит к низу, т.к. scrolledForRef сброшен).
      setNewerCursor(undefined)
      setCanLoadNewer(false)
      scrolledForRef.current = null
      void qc.invalidateQueries({ queryKey: chatKeys.messages(id) })
    } else {
      const len = messages.data?.length ?? 0
      if (len > 0) virtualizerRef.current?.scrollToIndex(len - 1, { align: 'end', smooth: true })
    }
    setNewSinceScroll(0)
    setShowScrollDown(false)
  }

  // ── Множественный выбор сообщений ───────────────────────────────────────────
  function enterSelect(m: ChatMessage): void {
    setSelectMode(true)
    setSelectedIds(new Set([m.id]))
  }
  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) setSelectMode(false)
      return next
    })
  }
  function exitSelect(): void {
    setSelectMode(false)
    setSelectedIds(new Set())
  }
  function bulkDelete(): void {
    if (!socket) return
    selectedIds.forEach((id) => socket.emit('message:delete', { messageId: id }))
    exitSelect()
  }
  function bulkCopy(): void {
    // Копируем в хронологическом порядке ленты (не в порядке выбора).
    const text = (messages.data ?? [])
      .filter((m) => selectedIds.has(m.id))
      .map((m) => m.content)
      .filter(Boolean)
      .join('\n')
    void navigator.clipboard?.writeText(text)
    toast.success(t('copied'))
    exitSelect()
  }

  // ── Свайп по строке списка чатов (мобильный, iOS/Telegram-стиль, двунаправленный) ──
  // Вправо → открывается левая панель «Прочитать · Закрепить»; влево → правая панель
  // «Без звука · Удалить». Во время жеста трансформируем узел напрямую (без ре-рендера ради
  // плавности), на отпускании — доводим анимацией и синхронизируем состояние.
  const ROW_BTN_W = 72 // ширина одной кнопки действия (w-[4.5rem])
  const ROW_OPEN_THRESHOLD = 56
  const LEFT_ACTIONS_W = 2 * ROW_BTN_W // Прочитать + Закрепить
  const RIGHT_ACTIONS_W = 2 * ROW_BTN_W // Без звука + Удалить

  // Текущее смещение строки по её открытому состоянию (право = +, лево = −).
  function rowOffset(id: string): number {
    if (swiped?.id !== id) return 0
    return swiped.side === 'left' ? LEFT_ACTIONS_W : -RIGHT_ACTIONS_W
  }

  function setRowTransform(el: HTMLElement | null, x: number, animate: boolean): void {
    if (!el) return
    el.style.transition = animate ? 'transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none'
    el.style.transform = x ? `translateX(${x}px)` : ''
  }

  function markChatRead(chatId: string): void {
    const chat = (qc.getQueryData<ChatListItem[]>(chatKeys.list()) ?? []).find(
      (c) => c.id === chatId,
    )
    if (!chat || chat.unreadCount === 0) return
    const lastId = chat.lastMessage?.id
    if (socket && lastId) socket.emit('message:read', { chatId, messageId: lastId })
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
      (old ?? []).map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)),
    )
  }

  function onRowTouchStart(e: React.TouchEvent<HTMLElement>, id: string): void {
    const tch = e.touches[0]
    if (!tch) return
    chatSwipe.current = {
      id,
      startX: tch.clientX,
      startY: tch.clientY,
      moved: false,
      el: e.currentTarget,
      base: rowOffset(id),
    }
  }
  function onRowTouchMove(e: React.TouchEvent<HTMLElement>): void {
    const s = chatSwipe.current
    const tch = e.touches[0]
    if (!s || !tch) return
    const dx = tch.clientX - s.startX
    const dy = tch.clientY - s.startY
    if (!s.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) s.moved = true
    if (!s.moved) return
    let x = s.base + dx
    // Резина за пределами хода панелей — с сопротивлением.
    if (x > LEFT_ACTIONS_W) x = LEFT_ACTIONS_W + (x - LEFT_ACTIONS_W) * 0.35
    else if (x < -RIGHT_ACTIONS_W) x = -RIGHT_ACTIONS_W + (x + RIGHT_ACTIONS_W) * 0.35
    setRowTransform(s.el, x, false)
  }
  function closeSwipedRow(id: string | null): void {
    if (id) setRowTransform(rowEls.current.get(id) ?? null, 0, true)
    setSwiped((cur) => (cur?.id === id ? null : cur))
  }
  function onRowTouchEnd(e: React.TouchEvent<HTMLElement>, id: string): void {
    const s = chatSwipe.current
    chatSwipe.current = null
    if (!s || !s.moved) return
    chatSwipedFlag.current = true
    const dx = (e.changedTouches[0]?.clientX ?? s.startX) - s.startX
    const finalX = s.base + dx
    // Соседнюю открытую строку всегда закрываем.
    const closeOther = (): void => {
      if (swiped && swiped.id !== id)
        setRowTransform(rowEls.current.get(swiped.id) ?? null, 0, true)
    }
    if (finalX > ROW_OPEN_THRESHOLD) {
      closeOther()
      setRowTransform(s.el, LEFT_ACTIONS_W, true)
      setSwiped({ id, side: 'left' })
    } else if (finalX < -ROW_OPEN_THRESHOLD) {
      closeOther()
      setRowTransform(s.el, -RIGHT_ACTIONS_W, true)
      setSwiped({ id, side: 'right' })
    } else {
      setRowTransform(s.el, 0, true)
      setSwiped((cur) => (cur?.id === id ? null : cur))
    }
  }

  // Подпись разделителя дня в ленте: Сегодня / Вчера / дата.
  function dayLabel(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const startOf = (x: Date): number =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000)
    if (diff === 0) return t('today')
    if (diff === 1) return t('yesterday')
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  }

  // #1: отправка по WS с nonce + пометка «отправляется» и таймаут «эхо не пришло → ошибка».
  function emitSend(chatId: string, nonce: string, content: string, replyToId?: string): void {
    const tempId = `tmp:${nonce}`
    setSendState((s) => ({ ...s, [tempId]: 'pending' }))
    socket?.emit('message:send', { chatId, content, replyToId, nonce })
    const prev = sendTimers.current.get(nonce)
    if (prev) clearTimeout(prev)
    sendTimers.current.set(
      nonce,
      setTimeout(() => {
        setSendState((s) => (s[tempId] === 'pending' ? { ...s, [tempId]: 'failed' } : s))
      }, 12_000),
    )
  }

  // Повторная отправка «зависшего» оптимистичного сообщения по клику (тот же nonce → эхо заменит пузырь).
  function retrySend(m: ChatMessage): void {
    if (!m.id.startsWith('tmp:')) return
    // Повтор загрузки медиа: заново шлём те же файлы под тем же tempId, возвращаем пузырь в «грузится».
    const media = mediaRetry.current.get(m.id)
    if (media) {
      if (!pendingMedia.current.some((p) => p.tempId === m.id)) {
        const urls = m.media.map((a) => a.localUrl).filter((u): u is string => !!u)
        pendingMedia.current.push({
          tempId: m.id,
          chatId: media.chatId,
          sig: mediaSig(m.media),
          localUrls: urls,
        })
      }
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(media.chatId), (old) =>
        (old ?? []).map((x) =>
          x.id === m.id
            ? { ...x, media: x.media.map((a) => ({ ...a, uploading: true, progress: 0 })) }
            : x,
        ),
      )
      void uploadFiles(
        m.id,
        media.chatId,
        media.content,
        media.replyToId,
        media.files,
        media.spoiler,
      )
      return
    }
    emitSend(m.chatId, m.id.slice(4), m.content, m.replyToId ?? undefined)
  }

  function send(): void {
    const content = text.trim()
    if (!activeId) return
    // Режим правки: редактируем существующее сообщение (сервер эхом пришлёт message:updated).
    if (editing) {
      if (content && socket) socket.emit('message:edit', { messageId: editing.id, content })
      setEditing(null)
      setText('')
      return
    }
    // Вложения отправляются из диалога AttachmentDialog; здесь — только текст.
    if (!content || !socket || !me) return
    // #1: оптимистичный пузырь — показываем сразу со статусом «отправляется», заменим по эхо nonce
    // (message:new с тем же nonce). Сервер шлёт эхо всем в комнате ровно один раз.
    const nonce =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    const temp: ChatMessage = {
      id: `tmp:${nonce}`,
      chatId: activeId,
      // Серверного номера у оптимистичного пузыря ещё нет; 0 не участвует в расчёте точки догона.
      seq: 0,
      senderId: me.id,
      content,
      replyToId: replyTo?.id ?? null,
      forwardedFromId: null,
      editedAt: null,
      pinnedAt: null,
      createdAt: new Date().toISOString(),
      sender: {
        id: me.id,
        firstName: me.firstName,
        lastName: me.lastName,
        avatarUrl: me.avatarUrl,
      },
      linkPreview: null,
      media: [],
      // Оптимистичная цитата ответа — показываем вложенный блок сразу (реальную заменит эхо).
      replyTo: replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content,
            senderId: replyTo.senderId,
            sender: replyTo.sender,
          }
        : null,
      forwardedFrom: null,
      sharedPost: null,
      reactions: [],
      poll: null,
      systemType: null,
      systemMeta: null,
    }
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), (old) => [...(old ?? []), temp])
    emitSend(activeId, nonce, content, replyTo?.id)
    socket.emit('typing:stop', { chatId: activeId })
    setText('')
    draftsRef.current.delete(activeId)
    // #3: отправили — гасим серверный черновик (и локальный таймер сохранения).
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    void saveChatDraft(activeId, '').catch(() => undefined)
    setReplyTo(null)
    setMentionQuery(null)
  }

  // ── Обработчики контекстного меню сообщения (Telegram-стиль) ────────────────
  function startEdit(m: ChatMessage): void {
    setEditing(m)
    setReplyTo(null)
    setText(m.content)
  }

  function deleteMessage(m: ChatMessage): void {
    if (socket) socket.emit('message:delete', { messageId: m.id })
  }

  function copyText(m: ChatMessage): void {
    void navigator.clipboard?.writeText(m.content)
    toast.success(t('copied'))
  }

  function copyLink(m: ChatMessage): void {
    // Ссылка ведёт на текущий chats-роут отправителя (роль-корректно) с deeplink-параметрами c/m.
    const url = `${window.location.origin}${window.location.pathname}?c=${m.chatId}&m=${m.id}`
    void navigator.clipboard?.writeText(url)
    toast.success(t('linkCopied'))
  }

  // Скролл к сообщению + мягкая подсветка (Telegram-стиль). Под виртуализацией целевая строка
  // может быть не смонтирована — скроллим по индексу через virtua (он её смонтирует), иначе фолбэк на DOM.
  function focusMessage(messageId: string): void {
    const idx = messages.data?.findIndex((x) => x.id === messageId) ?? -1
    if (idx < 0) {
      // Далёкое сообщение вне загруженного окна — подгружаем окно вокруг него (around) и скроллим там.
      void jumpToMessage(messageId)
      return
    }
    virtualizerRef.current?.scrollToIndex(idx, { align: 'center', smooth: true })
    setHighlightId(messageId)
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1400)
  }

  // ── Тач-жесты по сообщению (мобильный) ──────────────────────────────────────
  // Долгое нажатие → меню действий; свайп вправо → ответ. На десктопе жесты не мешают
  // (нет touch), контекстное меню/hover-кнопки остаются. touch-action:pan-y на строке
  // отдаёт вертикальный скролл браузеру, а горизонтальный жест — нам.
  const LONG_PRESS_MS = 450
  const SWIPE_REPLY_PX = 64
  const msgTouch = useRef<{
    m: ChatMessage
    startX: number
    startY: number
    bubble: HTMLElement | null
    timer: ReturnType<typeof setTimeout> | null
    longFired: boolean
    swiping: boolean
  } | null>(null)

  function resetBubble(bubble: HTMLElement | null, animate: boolean): void {
    if (!bubble) return
    bubble.style.transition = animate ? 'transform 150ms ease' : 'none'
    bubble.style.transform = ''
  }

  function onMsgTouchStart(e: React.TouchEvent<HTMLDivElement>, m: ChatMessage): void {
    const tch = e.touches[0]
    if (!tch) return
    const bubble = e.currentTarget.querySelector<HTMLElement>('[data-bubble]')
    const x = tch.clientX
    const y = tch.clientY
    const timer = setTimeout(() => {
      const s = msgTouch.current
      if (!s) return
      s.longFired = true
      resetBubble(s.bubble, true)
      setMenu({ message: m, x, y })
      // Тактильный отклик при срабатывании долгого нажатия (где поддерживается).
      if ('vibrate' in navigator) navigator.vibrate(8)
    }, LONG_PRESS_MS)
    msgTouch.current = {
      m,
      startX: x,
      startY: y,
      bubble,
      timer,
      longFired: false,
      swiping: false,
    }
  }

  function onMsgTouchMove(e: React.TouchEvent<HTMLDivElement>): void {
    const s = msgTouch.current
    const tch = e.touches[0]
    if (!s || !tch || s.longFired) return
    const dx = tch.clientX - s.startX
    const dy = tch.clientY - s.startY
    // Любое заметное движение отменяет долгое нажатие.
    if (s.timer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearTimeout(s.timer)
      s.timer = null
    }
    // Свайп вправо (преимущественно горизонтальный) → сдвигаем пузырь как визуальную подсказку.
    if (dx > 0 && Math.abs(dy) < 24) {
      s.swiping = true
      const shift = Math.min(dx, 72)
      if (s.bubble) {
        s.bubble.style.transition = 'none'
        s.bubble.style.transform = `translateX(${shift}px)`
      }
    } else if (s.swiping && dx <= 0) {
      resetBubble(s.bubble, false)
    }
  }

  function onMsgTouchEnd(e: React.TouchEvent<HTMLDivElement>): void {
    const s = msgTouch.current
    if (!s) return
    if (s.timer) {
      clearTimeout(s.timer)
      s.timer = null
    }
    const dx = (e.changedTouches[0]?.clientX ?? s.startX) - s.startX
    resetBubble(s.bubble, true)
    // Свайп вправо дальше порога (и это не было долгим нажатием) → ответ на сообщение.
    if (!s.longFired && s.swiping && dx > SWIPE_REPLY_PX) setReplyTo(s.m)
    msgTouch.current = null
  }

  // Единая навигация по закреплённым (клик по бару и стрелки ◀▶ используют её — без рассинхрона).
  // Первое взаимодействие фокусирует показанное сообщение; далее шаг вперёд/назад по кругу.
  function navigatePinned(pinned: ChatMessage[], dir: 1 | -1): void {
    if (pinned.length === 0) return
    const base = pinnedIndex % pinned.length
    const target = pinnedTouched
      ? (((base + dir) % pinned.length) + pinned.length) % pinned.length
      : base
    const msg = pinned[target]
    if (!msg) return
    setPinnedIndex(target)
    setPinnedTouched(true)
    focusMessage(msg.id)
  }

  function onType(v: string): void {
    setText(v)
    if (activeId) {
      draftsRef.current.set(activeId, v)
      // #3: дебаунс-сохранение черновика на сервер (синхронизация между устройствами).
      const chatId = activeId
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      draftSaveTimer.current = setTimeout(() => {
        void saveChatDraft(chatId, v).catch(() => undefined)
      }, 800)
    }
    // Определяем @-запрос перед курсором для автодополнения упоминаний.
    const pos = composerRef.current?.selectionStart ?? v.length
    const m = v.slice(0, pos).match(/(?:^|\s)@(\S*)$/)
    setMentionQuery(m ? (m[1] ?? '') : null)
    if (!socket || !activeId) return
    const now = Date.now()
    if (now - typingSentAt.current > 3000) {
      typingSentAt.current = now
      socket.emit('typing:start', { chatId: activeId })
    }
  }

  // Вставка упоминания: заменяет «@запрос» перед курсором на «@Имя Фамилия ».
  function insertMention(u: ChatMemberInfo): void {
    const el = composerRef.current
    const pos = el?.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    const name = `${u.firstName} ${u.lastName}`.trim()
    const newBefore = before.replace(/(^|\s)@(\S*)$/, (_full, p1: string) => `${p1}@${name} `)
    const next = newBefore + after
    setText(next)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(newBefore.length, newBefore.length)
    })
  }

  // Отфильтрованные кандидаты упоминания (по имени/фамилии), максимум 6.
  const mentionCandidates =
    mentionQuery === null
      ? []
      : (membersQuery.data ?? [])
          .filter((u) => {
            const q = mentionQuery.toLowerCase()
            return (
              `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
              `${u.lastName} ${u.firstName}`.toLowerCase().includes(q)
            )
          })
          .slice(0, 6)

  // Выбор файлов открывает диалог отправки; повторный выбор при открытом диалоге — добавляет.
  function addFiles(list: FileList | null): void {
    const arr = Array.from(list ?? [])
    if (arr.length === 0) return
    setAttachFiles((prev) => (attachOpen ? [...prev, ...arr] : arr))
    setAttachOpen(true)
  }

  async function loadOlder(): Promise<void> {
    if (!activeId || !olderCursor) return
    setLoadingOlder(true)
    try {
      const page = await fetchMessages(activeId, { limit: 30, cursor: olderCursor })
      const older = [...page.items].reverse()
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), (old) => [
        ...older,
        ...(old ?? []),
      ])
      setOlderCursor(page.cursor)
      setCanLoadOlder(page.hasNext)
    } finally {
      setLoadingOlder(false)
    }
  }

  // Подгрузка более НОВЫХ (вниз) — актуально после jump в «прыгнутое» окно (around).
  async function loadNewer(): Promise<void> {
    if (!activeId || !newerCursor || loadingNewerRef.current) return
    loadingNewerRef.current = true
    try {
      const page = await fetchMessages(activeId, {
        limit: 30,
        cursor: newerCursor,
        direction: 'newer',
      })
      const newer = [...page.items].reverse() // desc → asc (хронологически), в конец списка
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), (old) => {
        const prev = old ?? []
        const seen = new Set(prev.map((m) => m.id))
        return [...prev, ...newer.filter((m) => !seen.has(m.id))]
      })
      // Догрузка вниз — не «новое входящее»: не даём эффекту автоскролла увести к низу.
      const updated = qc.getQueryData<ChatMessage[]>(chatKeys.messages(activeId))
      lastMsgIdRef.current = updated?.[updated.length - 1]?.id ?? lastMsgIdRef.current
      setNewerCursor(page.prevCursor)
      setCanLoadNewer(page.hasPrev)
    } finally {
      loadingNewerRef.current = false
    }
  }

  // Переход к далёкому сообщению (Этап 1): подгружаем окно вокруг него (around), заменяем историю,
  // выставляем оба курсора (старее/новее), скроллим к цели и подсвечиваем.
  // Применить «окно» (around/aroundDate) к истории: заменить кэш, выставить оба курсора,
  // защитить эффект автоскролла (lastMsgIdRef). Возвращает хронологический массив окна.
  function applyMessageWindow(page: Awaited<ReturnType<typeof fetchMessages>>): ChatMessage[] {
    const win = [...page.items].reverse()
    if (!activeId) return win
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), win)
    lastMsgIdRef.current = win[win.length - 1]?.id ?? null
    setOlderCursor(page.cursor)
    setCanLoadOlder(page.hasNext)
    setNewerCursor(page.prevCursor)
    setCanLoadNewer(page.hasPrev)
    return win
  }

  async function jumpToMessage(messageId: string): Promise<void> {
    if (!activeId) return
    const win = applyMessageWindow(await fetchMessages(activeId, { limit: 30, around: messageId }))
    requestAnimationFrame(() => {
      const idx = win.findIndex((x) => x.id === messageId)
      if (idx >= 0) virtualizerRef.current?.scrollToIndex(idx, { align: 'center', smooth: true })
      setHighlightId(messageId)
      window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1400)
    })
  }

  // Переход по дате (#5): окно вокруг первого сообщения на/после начала выбранного дня (локально).
  async function jumpToDate(ymd: string): Promise<void> {
    if (!activeId || !ymd) return
    const from = new Date(`${ymd}T00:00:00`)
    const win = applyMessageWindow(
      await fetchMessages(activeId, { limit: 30, aroundDate: from.toISOString() }),
    )
    requestAnimationFrame(() => {
      // Первое сообщение дня — наверх (align:start); если на/после даты ничего нет — к низу.
      const at = win.findIndex((m) => new Date(m.createdAt).getTime() >= from.getTime())
      const idx = at >= 0 ? at : win.length - 1
      if (idx >= 0) virtualizerRef.current?.scrollToIndex(idx, { align: 'start', smooth: true })
      const hit = at >= 0 ? win[at] : undefined
      if (hit) {
        setHighlightId(hit.id)
        window.setTimeout(() => setHighlightId((cur) => (cur === hit.id ? null : cur)), 1400)
      }
    })
  }

  // Новые результаты in-chat поиска → прыгаем к самому свежему совпадению (idx 0), один раз на набор.
  useEffect(() => {
    if (!chatSearchOpen) return
    const items = chatSearchResults.data?.items ?? []
    const first = items[0]
    const key = `${chatSearchTerm}:${items.length}:${first?.id ?? ''}`
    if (!first || searchJumpedFor.current === key) return
    searchJumpedFor.current = key
    setSearchIdx(0)
    void jumpToMessage(first.id)
  }, [chatSearchOpen, chatSearchTerm, chatSearchResults.data, jumpToMessage])

  // Шаг по совпадениям: dir=+1 — старее (следующее), -1 — новее (предыдущее). Прыгаем к сообщению.
  function stepSearch(dir: 1 | -1): void {
    const items = chatSearchResults.data?.items ?? []
    if (items.length === 0) return
    const next = Math.min(Math.max(searchIdx + dir, 0), items.length - 1)
    setSearchIdx(next)
    const m = items[next]
    if (m) void jumpToMessage(m.id)
  }

  function closeChatSearch(): void {
    setChatSearchOpen(false)
    setChatSearchRaw('')
    setChatSearchTerm('')
    setSearchIdx(0)
    setSearchFrom(null)
    setSearchFromOpen(false)
    searchJumpedFor.current = null
  }

  const typingCount = Object.keys(typingUsers).length
  // Подпись «печатает…» для шапки (Telegram-стиль): в группе — с именем первого набирающего.
  const firstTyperId = Object.keys(typingUsers)[0]
  const firstTyperName = firstTyperId
    ? membersQuery.data?.find((u) => u.id === firstTyperId)?.firstName
    : undefined
  const activeChat = chats.data?.find((c) => c.id === activeId)
  const activeIsGroup = activeChat != null && activeChat.type !== 'PRIVATE'
  // Роли участников для бейджей у сообщений (§21): только «заметные» роли + админ группы, не студенты.
  const roleByUser = useMemo(() => {
    const map = new Map<string, { role: string; isAdmin: boolean }>()
    for (const m of membersQuery.data ?? []) map.set(m.id, { role: m.role, isAdmin: m.isAdmin })
    return map
  }, [membersQuery.data])
  function senderBadge(userId: string): string | null {
    const info = roleByUser.get(userId)
    if (!info) return null
    if (info.role === 'TEACHER' || info.role === 'DEAN' || info.role === 'STAROSTA')
      return tRoles(info.role)
    if (info.isAdmin) return t('adminBadge')
    return null
  }
  // #6: сколько участников прочитали сообщение (lastReadAt ≥ его времени) — для метки в группах.
  function readByCount(createdAt: string): number {
    const at = new Date(createdAt).getTime()
    return (readsQuery.data ?? []).filter(
      (r) => r.lastReadAt != null && new Date(r.lastReadAt).getTime() >= at,
    ).length
  }
  const list = useMemo(() => chats.data ?? [], [chats.data])
  // Единый поиск: чаты по названию + сообщения (глобально). Показываем двумя секциями.
  const chatById = useMemo(() => new Map(list.map((c) => [c.id, c])), [list])
  const chatMatches = useMemo(() => {
    const q = listSearchTerm.toLowerCase()
    return q.length >= 2 ? list.filter((c) => chatTitle(c, t).toLowerCase().includes(q)) : []
  }, [list, listSearchTerm, t])
  const msgMatches = listMsgResults.data?.items ?? []
  const pinnedList = pinned.data ?? []
  const hasText = text.trim().length > 0
  // Кнопка отправки показывается при вводе/вложениях/правке; иначе — микрофон (Telegram-стиль).
  const showSend = !!editing || hasText
  const recMMSS = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`
  const isPrivate = activeChat?.type === 'PRIVATE'
  const memberIds = Object.keys(presence)
  const otherId = memberIds.find((id) => id !== myId)
  const otherOnline = isPrivate && otherId ? presence[otherId] === true : false
  const onlineOthers = memberIds.filter((id) => id !== myId && presence[id]).length
  // Личная блокировка: скрываем поле ввода (нельзя писать — я заблокировал или меня заблокировали).
  const blockedActive = isPrivate && !!activeChat && (activeChat.blocked || activeChat.blockedBy)

  // Пропсы панели деталей чата — одни и те же для колонки (ПК) и модалки (планшет/мобильный),
  // чтобы презентация решалась одним `isWide`, а не двумя разными экранами.
  const detailsProps = activeChat
    ? {
        chat: activeChat,
        title: chatTitle(activeChat, t),
        isPrivate,
        peerOnline: otherOnline,
        myId,
        onClose: () => setDetailsOpen(false),
        onMute: (mode: number | 'forever', importantOnly?: boolean) =>
          mute.mutate({
            chatId: activeChat.id,
            muted: true,
            minutes: mode === 'forever' ? undefined : mode,
            importantOnly,
          }),
        onUnmute: () => mute.mutate({ chatId: activeChat.id, muted: false }),
        onOpenPeerProfile: otherId ? () => setPeerCardOpen(true) : undefined,
        onJump: focusMessage,
        onLeft: () => {
          setDetailsOpen(false)
          setActiveId(null)
        },
        onOpenChat: (id: string) => {
          setDetailsOpen(false)
          setActiveId(id)
        },
      }
    : null

  // Стабильный диспетчер действий над сообщением (см. MessageItem). Всегда зовёт свежие
  // обработчики через ref — идентичность объекта не меняется между рендерами, поэтому memo
  // реально пропускает перерисовку невизуально-изменившихся пузырей (#57).
  const msgHandlersRef = useRef({
    setReplyTo,
    setMenu,
    setForwardMsg,
    focusMessage,
    copyText,
    deleteMessage,
    retrySend,
    toggleSelect,
    react,
    onMsgTouchStart,
    onMsgTouchMove,
    onMsgTouchEnd,
  })
  msgHandlersRef.current = {
    setReplyTo,
    setMenu,
    setForwardMsg,
    focusMessage,
    copyText,
    deleteMessage,
    retrySend,
    toggleSelect,
    react,
    onMsgTouchStart,
    onMsgTouchMove,
    onMsgTouchEnd,
  }
  const messageActions = useMemo<MessageActions>(
    () => ({
      reply: (m) => msgHandlersRef.current.setReplyTo(m),
      openMenu: (m, x, y) => msgHandlersRef.current.setMenu({ message: m, x, y }),
      focus: (id) => msgHandlersRef.current.focusMessage(id),
      copy: (m) => msgHandlersRef.current.copyText(m),
      forward: (m) => msgHandlersRef.current.setForwardMsg(m),
      del: (m) => msgHandlersRef.current.deleteMessage(m),
      retry: (m) => msgHandlersRef.current.retrySend(m),
      toggleSelect: (id) => msgHandlersRef.current.toggleSelect(id),
      react: (id, emoji) => msgHandlersRef.current.react.mutate({ messageId: id, emoji }),
      touchStart: (e, m) => msgHandlersRef.current.onMsgTouchStart(e, m),
      touchMove: (e) => msgHandlersRef.current.onMsgTouchMove(e),
      touchEnd: (e) => msgHandlersRef.current.onMsgTouchEnd(e),
    }),
    [],
  )

  // Список чатов — на мобильном во весь экран; на десктопе порталится в сайдбар (embedded).
  const chatList = (
    <ConversationList
      embedded={embedded}
      activeId={activeId}
      onOpenChat={setActiveId}
      onBack={() => router.back()}
      folders={folderList}
      onManageFolders={() => setFoldersOpen(true)}
      newChatOpen={newChatOpen}
      onToggleNewChat={() => setNewChatOpen((v) => !v)}
      onCloseNewChat={() => setNewChatOpen(false)}
      onNewGroup={() => {
        setCreateGroupOpen(true)
        setNewChatOpen(false)
      }}
      onOpenSaved={() => {
        setNewChatOpen(false)
        void fetchSavedChat()
          .then(({ id }) => {
            void qc.invalidateQueries({ queryKey: chatKeys.list() })
            setActiveId(id)
          })
          .catch((e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')))
      }}
      onOpenBlocked={() => setBlockedOpen(true)}
      searchRaw={listSearchRaw}
      onSearchChange={setListSearchRaw}
      onClearSearch={() => {
        setListSearchRaw('')
        setListSearchTerm('')
      }}
      searchTerm={listSearchTerm}
      chatMatches={chatMatches}
      msgMatches={msgMatches}
      msgResultsLoading={listMsgResults.isLoading}
      chatById={chatById}
      chats={list}
      chatsLoading={chats.isLoading}
      myId={myId}
      locale={locale}
      swiped={swiped}
      swipedFlagRef={chatSwipedFlag}
      rowElsRef={rowEls}
      onRowTouchStart={onRowTouchStart}
      onRowTouchMove={onRowTouchMove}
      onRowTouchEnd={onRowTouchEnd}
      onCloseSwiped={closeSwipedRow}
      onMarkRead={markChatRead}
      onTogglePin={(c) => pin.mutate({ chatId: c.id, pinned: !c.pinned })}
      onToggleMute={(c) => mute.mutate({ chatId: c.id, muted: !c.muted })}
      onDeleteChat={(c) => {
        const msg =
          c.type !== 'PRIVATE' && c.isOwner ? t('deleteGroupConfirm') : t('deleteChatConfirm')
        void confirm({ title: msg, destructive: true }).then((ok) => {
          if (ok) deleteChat.mutate(c.id)
        })
      }}
    />
  )

  return (
    <div className="-mx-4 -mt-4 -mb-24 flex h-[calc(100%+7rem)] overflow-hidden md:-m-6 md:h-[calc(100%+3rem)]">
      {embedded && listSlot ? createPortal(chatList, listSlot) : chatList}

      {/* Панель сообщений — на мобильном во весь экран; скрыта, пока чат не выбран. */}
      <section className={cn('min-w-0 flex-1 flex-col', activeId ? 'flex' : 'hidden md:flex')}>
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6 duration-300 animate-in fade-in zoom-in-95">
            <span className="rounded-full border border-border bg-muted/40 px-4 py-2 text-center text-sm text-muted-foreground">
              {t('selectChatPrompt')}
            </span>
          </div>
        ) : (
          // key={activeId} — контент разговора заново проигрывает анимацию при открытии/смене чата.
          <div
            key={activeId}
            className="flex min-h-0 flex-1 flex-col duration-300 animate-in fade-in slide-in-from-right-4"
          >
            {/* Панель множественного выбора (Telegram-стиль): счётчик + копировать/переслать/удалить. */}
            {selectMode && (
              <header className="flex items-center gap-1 border-b border-border px-2 py-3">
                <button
                  type="button"
                  aria-label={t('cancel')}
                  onClick={exitSelect}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
                >
                  <X className="size-5" aria-hidden />
                </button>
                <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
                  {t('selectedCount', { count: selectedIds.size })}
                </span>
                <button
                  type="button"
                  aria-label={t('copyText')}
                  disabled={selectedIds.size === 0}
                  onClick={bulkCopy}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Copy className="size-5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('forward')}
                  disabled={selectedIds.size === 0}
                  onClick={() => setForwardIds([...selectedIds])}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Forward className="size-5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('delete')}
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    void confirm({
                      title: t('deleteSelectedConfirm', { count: selectedIds.size }),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) bulkDelete()
                    })
                  }}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                >
                  <Trash2 className="size-5" aria-hidden />
                </button>
              </header>
            )}
            {/* Режим поиска внутри чата (§3): ввод + счётчик совпадений + навигация ↑↓. */}
            {chatSearchOpen &&
              (() => {
                const found = chatSearchResults.data?.items ?? []
                const total = found.length
                return (
                  <header className="flex items-center gap-1 border-b border-border px-2 py-3">
                    <button
                      type="button"
                      aria-label={t('cancel')}
                      onClick={closeChatSearch}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
                    >
                      <ChevronLeft className="size-5" aria-hidden />
                    </button>
                    <div className="relative min-w-0 flex-1">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <input
                        autoFocus
                        value={chatSearchRaw}
                        onChange={(e) => setChatSearchRaw(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            stepSearch(e.shiftKey ? -1 : 1)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            closeChatSearch()
                          }
                        }}
                        placeholder={t('searchInChat')}
                        className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                      />
                    </div>
                    {/* Фильтр «От кого» (§4) — только в группах. */}
                    {activeIsGroup && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          aria-label={t('searchFrom')}
                          onClick={() => setSearchFromOpen((v) => !v)}
                          className={cn(
                            'flex h-9 max-w-28 items-center gap-1 rounded-lg px-2 text-xs transition-colors',
                            searchFrom
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:bg-muted',
                          )}
                        >
                          <UserSearch className="size-4 shrink-0" aria-hidden />
                          {searchFrom && <span className="truncate">{searchFrom.name}</span>}
                        </button>
                        {searchFromOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setSearchFromOpen(false)}
                            />
                            <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
                              <button
                                type="button"
                                onClick={() => {
                                  setSearchFrom(null)
                                  setSearchFromOpen(false)
                                }}
                                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                              >
                                {t('searchFromAll')}
                              </button>
                              {(membersQuery.data ?? []).map((mem) => {
                                const name = `${mem.lastName} ${mem.firstName}`.trim()
                                return (
                                  <button
                                    key={mem.id}
                                    type="button"
                                    onClick={() => {
                                      setSearchFrom({ id: mem.id, name })
                                      setSearchFromOpen(false)
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                                  >
                                    <Avatar className="size-6 shrink-0">
                                      {mem.avatarUrl && (
                                        <AvatarImage src={mem.avatarUrl} alt={name} />
                                      )}
                                      <AvatarFallback className="text-[0.6rem]">
                                        {(mem.lastName[0] ?? '') + (mem.firstName[0] ?? '')}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="min-w-0 flex-1 truncate">{name}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {chatSearchResults.isFetching ? (
                      <Loader2
                        className="size-4 shrink-0 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      chatSearchTerm.length >= 2 && (
                        <span className="shrink-0 whitespace-nowrap px-1 text-xs tabular-nums text-muted-foreground">
                          {total > 0 ? `${searchIdx + 1}/${total}` : t('noResults')}
                        </span>
                      )
                    )}
                    <button
                      type="button"
                      aria-label={t('searchPrev')}
                      onClick={() => stepSearch(-1)}
                      disabled={total === 0 || searchIdx <= 0}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <ChevronUp className="size-5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={t('searchNext')}
                      onClick={() => stepSearch(1)}
                      disabled={total === 0 || searchIdx >= total - 1}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <ChevronDown className="size-5" aria-hidden />
                    </button>
                  </header>
                )
              })()}
            <header
              className={cn(
                'flex items-center justify-between gap-1 border-b border-border px-3 py-3 md:px-4',
                (selectMode || chatSearchOpen) && 'hidden',
              )}
            >
              {/* Назад к списку — только на мобильном */}
              <button
                type="button"
                aria-label={t('back')}
                onClick={() => setActiveId(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left transition-colors hover:bg-muted"
              >
                <span className="relative shrink-0">
                  <Avatar className="size-9">
                    {activeChat?.avatarUrl && (
                      <AvatarImage
                        src={activeChat.avatarUrl}
                        alt={activeChat ? chatTitle(activeChat, t) : ''}
                      />
                    )}
                    <AvatarFallback
                      className={cn(
                        'text-xs font-medium text-white',
                        avatarColor(activeChat?.id ?? ''),
                      )}
                    >
                      {activeChat ? chatInitials(chatTitle(activeChat, t)) : '#'}
                    </AvatarFallback>
                  </Avatar>
                  {isPrivate && otherOnline && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-success"
                      aria-hidden
                    />
                  )}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">
                    {activeChat ? chatTitle(activeChat, t) : ''}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {typingCount > 0 ? (
                      <span className="text-primary">
                        {isPrivate || typingCount > 1 || !firstTyperName
                          ? isPrivate
                            ? t('typingStatus')
                            : t('typingMany')
                          : t('typingStatusName', { name: firstTyperName })}
                      </span>
                    ) : isPrivate ? (
                      otherOnline ? (
                        t('online')
                      ) : (
                        t('offlineStatus')
                      )
                    ) : (
                      t('membersOnline', { count: onlineOthers })
                    )}
                  </span>
                </div>
              </button>
              <div className="flex items-center gap-1">
                {!connected && (
                  <span className="mr-1 flex items-center gap-1 text-xs text-destructive">
                    <WifiOff className="size-3.5" aria-hidden />
                    {t('offline')}
                  </span>
                )}
                {/* Поиск внутри чата (§3). */}
                <button
                  type="button"
                  aria-label={t('searchInChat')}
                  onClick={() => setChatSearchOpen(true)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Search className="size-4" aria-hidden />
                </button>
                {/* Переход по дате (#5): клик по числу сразу прокручивает историю к этому
                    дню и закрывает календарь — как в мессенджерах. Дата — действие, а не
                    значение формы, поэтому ни поля с текстом даты, ни «Готово» тут нет.
                    Будущее закрыто: сообщений там заведомо нет. */}
                <DateJumpPicker
                  value={jumpDate}
                  onChange={(ymd) => {
                    setJumpDate(ymd)
                    if (ymd) void jumpToDate(ymd)
                  }}
                  max={formatYmd(new Date())}
                  aria-label={t('jumpToDate')}
                />
                {/* Действия — в меню «три точки». */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setHeaderMenuOpen((v) => !v)}
                    aria-label={t('messageActions')}
                    className={cn(
                      'relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      headerMenuOpen && 'bg-muted text-foreground',
                    )}
                  >
                    <MoreVertical className="size-4" aria-hidden />
                    {activeChat?.muted && (
                      <span
                        className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                        aria-hidden
                      />
                    )}
                  </button>
                  {headerMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setHeaderMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full z-50 mt-1 w-56 origin-top-right overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 slide-in-from-top-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (activeChat)
                              mute.mutate({ chatId: activeChat.id, muted: !activeChat.muted })
                            setHeaderMenuOpen(false)
                          }}
                          className={cn(
                            'flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted',
                            activeChat?.muted && 'text-destructive',
                          )}
                        >
                          {activeChat?.muted ? (
                            <BellOff className="size-4 shrink-0 opacity-80" aria-hidden />
                          ) : (
                            <Bell className="size-4 shrink-0 opacity-80" aria-hidden />
                          )}
                          <span className="flex-1 text-left">
                            {activeChat?.muted ? t('unmute') : t('mute')}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={exportChat.isPending}
                          onClick={() => {
                            exportChat.mutate('txt')
                            setHeaderMenuOpen(false)
                          }}
                          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          {exportChat.isPending ? (
                            <Loader2
                              className="size-4 shrink-0 animate-spin opacity-80"
                              aria-hidden
                            />
                          ) : (
                            <Download className="size-4 shrink-0 opacity-80" aria-hidden />
                          )}
                          <span className="flex-1 text-left">{t('export')}</span>
                        </button>
                        {isPrivate && otherId && activeChat && (
                          <button
                            type="button"
                            disabled={block.isPending}
                            onClick={() => {
                              block.mutate({ userId: otherId, blocked: activeChat.blocked })
                              setHeaderMenuOpen(false)
                            }}
                            className={cn(
                              'flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50',
                              !activeChat.blocked && 'text-destructive',
                            )}
                          >
                            <Ban className="size-4 shrink-0 opacity-80" aria-hidden />
                            <span className="flex-1 text-left">
                              {activeChat.blocked ? t('unblockUser') : t('blockUser')}
                            </span>
                          </button>
                        )}
                        {activeChat && (
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderMenuOpen(false)
                              void confirm({
                                title: t('clearHistoryConfirm'),
                                destructive: true,
                              }).then((ok) => {
                                if (ok) clearChat.mutate(activeChat.id)
                              })
                            }}
                            className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted"
                          >
                            <Eraser className="size-4 shrink-0 opacity-80" aria-hidden />
                            <span className="flex-1 text-left">{t('clearHistory')}</span>
                          </button>
                        )}
                        {activeChat && (
                          <button
                            type="button"
                            onClick={() => {
                              const msg =
                                !isPrivate && activeChat.isOwner
                                  ? t('deleteGroupConfirm')
                                  : t('deleteChatConfirm')
                              setHeaderMenuOpen(false)
                              void confirm({ title: msg, destructive: true }).then((ok) => {
                                if (ok) deleteChat.mutate(activeChat.id)
                              })
                            }}
                            className="flex h-9 w-full items-center gap-2 px-3 text-sm text-destructive transition-colors hover:bg-destructive/10"
                          >
                            <Trash2 className="size-4 shrink-0 opacity-80" aria-hidden />
                            <span className="flex-1 text-left">
                              {!isPrivate && activeChat.isOwner
                                ? t('deleteGroup')
                                : t('deleteChat')}
                            </span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </header>

            {/* Закреплённое сообщение (Telegram-стиль): одна строка, клик — переход + цикл */}
            {pinnedList.length > 0 &&
              (() => {
                const idx = pinnedIndex % pinnedList.length
                const cur = pinnedList[idx]
                if (!cur) return null
                return (
                  <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
                    {/* Клик по строке циклически переходит к следующему закреплённому (navigatePinned). */}
                    <button
                      type="button"
                      onClick={() => navigatePinned(pinnedList, 1)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="h-4 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      <Pin className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {cur.content || (cur.media.length ? t('attachment') : '')}
                      </span>
                      {pinnedList.length > 1 && (
                        <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                          {idx + 1}/{pinnedList.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={t('unpin')}
                      onClick={() => setPin.mutate({ id: cur.id, pinned: false })}
                      className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <PinOff className="size-3.5" aria-hidden />
                    </button>
                  </div>
                )
              })()}

            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Спиннер догрузки старых — оверлей, чтобы не влиять на измерение высот virtua (startMargin=0). */}
              {loadingOlder && (
                <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center text-muted-foreground">
                  <span className="rounded-full bg-background/80 p-1 shadow-sm backdrop-blur">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  </span>
                </div>
              )}
              {/* Плавающий заголовок даты (§6): дата верхних видимых сообщений, гаснет вне скролла. */}
              {floatingDay && !loadingOlder && (
                <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                  <span
                    className={cn(
                      'rounded-full bg-muted/90 px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-opacity duration-300',
                      floatingDayShown ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    {floatingDay}
                  </span>
                </div>
              )}
              <div
                ref={messagesScrollRef}
                onScroll={onMessagesScroll}
                className="flex-1 overflow-y-auto p-4"
              >
                {messages.isLoading ? (
                  <div className="flex justify-center py-8 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                  </div>
                ) : (
                  <Virtualizer ref={virtualizerRef} scrollRef={messagesScrollRef} shift={shiftMode}>
                    {(messages.data ?? []).map((m, i) => {
                      const mine = m.senderId === myId
                      // Группировка подряд идущих сообщений одного автора: аватар/имя — только у первого в серии.
                      const arr = messages.data ?? []
                      const prevMsg = arr[i - 1]
                      const firstOfRun = prevMsg?.senderId !== m.senderId
                      // Разделитель дня: перед первым сообщением и при смене календарного дня.
                      const showDay =
                        !prevMsg ||
                        new Date(prevMsg.createdAt).toDateString() !==
                          new Date(m.createdAt).toDateString()
                      // Статус доставки своего сообщения (#51) считаем здесь — единый источник
                      // readWatermark/onlineOthers/sendState; в MessageItem уходит примитивом.
                      let readState: MessageReadState = 'sent'
                      let readCount = 0
                      if (mine) {
                        const st = sendState[m.id]
                        if (st === 'pending') readState = 'pending'
                        else if (st === 'failed') readState = 'failed'
                        else {
                          const read =
                            readWatermark != null &&
                            new Date(readWatermark).getTime() >= new Date(m.createdAt).getTime()
                          if (read) {
                            readState = 'read'
                            readCount = activeIsGroup ? readByCount(m.createdAt) : 0
                          } else if (onlineOthers > 0) readState = 'delivered'
                        }
                      }
                      return (
                        <MessageItem
                          key={m.id}
                          m={m}
                          mine={mine}
                          firstOfRun={firstOfRun}
                          isFirstInList={i === 0}
                          showDay={showDay}
                          dayText={showDay ? dayLabel(m.createdAt) : null}
                          isUnreadDivider={unreadDividerId === m.id}
                          highlighted={highlightId === m.id}
                          selecting={selectMode}
                          selected={selectedIds.has(m.id)}
                          menuActive={menu?.message.id === m.id}
                          readState={readState}
                          readCount={readCount}
                          locale={locale}
                          senderNameText={senderName(m)}
                          senderBadge={!mine && activeIsGroup ? senderBadge(m.senderId) : null}
                          replyToNameText={m.replyTo ? senderName(m.replyTo) : null}
                          forwardedFromNameText={
                            m.forwardedFrom ? senderName(m.forwardedFrom) : null
                          }
                          myId={myId}
                          highlightTerm={
                            chatSearchOpen && chatSearchTerm.length >= 2
                              ? chatSearchTerm
                              : undefined
                          }
                          actions={messageActions}
                        />
                      )
                    })}
                  </Virtualizer>
                )}
              </div>
              {/* Кнопка «вниз» со счётчиком новых — появляется, когда пролистано вверх (Telegram-стиль). */}
              {showScrollDown && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  aria-label={t('scrollToBottom')}
                  className="absolute right-3 bottom-3 z-20 flex size-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-transform hover:bg-muted active:scale-95"
                >
                  <ChevronDown className="size-5" aria-hidden />
                  {newSinceScroll > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-bold text-primary-foreground">
                      {newSinceScroll > 99 ? '99+' : newSinceScroll}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* «печатает…» показываем в шапке (вместо статуса), а не здесь — Telegram-стиль. */}

            <ChatComposer
              editing={editing}
              onCancelEdit={() => {
                setEditing(null)
                setText('')
              }}
              replyTo={replyTo}
              replyToName={replyTo ? senderName(replyTo) : ''}
              onCancelReply={() => setReplyTo(null)}
              blocked={!!blockedActive}
              iBlocked={!!activeChat?.blocked}
              otherId={otherId}
              onUnblock={() => otherId && block.mutate({ userId: otherId, blocked: true })}
              text={text}
              onType={onType}
              onSend={send}
              showSend={showSend}
              connected={connected}
              composerRef={composerRef}
              fileInputRef={fileInputRef}
              onFilesPicked={addFiles}
              onCreatePoll={isPrivate ? undefined : () => setPollCreatorOpen(true)}
              mentionCandidates={mentionCandidates}
              onInsertMention={insertMention}
              onCloseMentions={() => setMentionQuery(null)}
              myId={myId}
              voice={voice}
              recMMSS={recMMSS}
            />
          </div>
        )}
      </section>

      {/* Детали чата — одна панель на все размеры экрана, второго экрана с тем же
          содержимым нет (§55). На ПК (≥xl) — докнутая третья колонка: ширина анимируется,
          центральная переписка адаптивно сужается и остаётся активной. На планшете и
          мобильном та же панель открывается в системном модальном окне. */}
      {isWide ? (
        <aside
          className={cn(
            'hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out xl:block',
            detailsOpen && activeChat ? 'w-[22rem] border-l border-border' : 'w-0',
          )}
          aria-hidden={!(detailsOpen && activeChat)}
        >
          {detailsProps && (
            <div className="h-full w-[22rem]">
              <ChatDetailsPanel key={detailsProps.chat.id} {...detailsProps} variant="column" />
            </div>
          )}
        </aside>
      ) : (
        detailsOpen &&
        detailsProps && (
          <Modal
            onClose={() => setDetailsOpen(false)}
            title={t('details')}
            size="lg"
            className="h-[min(90vh,44rem)]"
            bodyClassName="overflow-hidden p-0"
          >
            <ChatDetailsPanel key={detailsProps.chat.id} {...detailsProps} variant="modal" />
          </Modal>
        )
      )}

      {menu && (
        <MessageContextMenu
          message={menu.message}
          mine={menu.message.senderId === myId}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          actions={{
            onReact: (emoji) => react.mutate({ messageId: menu.message.id, emoji }),
            onReply: () => setReplyTo(menu.message),
            onEdit: () => startEdit(menu.message),
            onPin: () => setPin.mutate({ id: menu.message.id, pinned: !menu.message.pinnedAt }),
            onCopy: () => copyText(menu.message),
            onCopyLink: () => copyLink(menu.message),
            onForward: () => setForwardMsg(menu.message),
            onDelete: () => deleteMessage(menu.message),
            onSelect: () => enterSelect(menu.message),
          }}
        />
      )}

      {forwardMsg && (
        <ForwardDialog
          chats={list}
          currentChatId={activeId}
          titleOf={(c) => chatTitle(c, t)}
          onPick={(targetChatId) => forward.mutate({ targetChatId, messageId: forwardMsg.id })}
          onClose={() => setForwardMsg(null)}
        />
      )}

      {/* Пересылка нескольких выбранных сообщений (мультивыбор): по одному forward на каждое. */}
      {forwardIds && (
        <ForwardDialog
          chats={list}
          currentChatId={activeId}
          titleOf={(c) => chatTitle(c, t)}
          onPick={(targetChatId) =>
            forwardIds.forEach((messageId) => forward.mutate({ targetChatId, messageId }))
          }
          onClose={() => {
            setForwardIds(null)
            exitSelect()
          }}
        />
      )}

      {createGroupOpen && (
        <CreateGroupDialog
          onClose={() => setCreateGroupOpen(false)}
          onCreated={(chatId) => {
            setCreateGroupOpen(false)
            setActiveId(chatId)
          }}
        />
      )}

      <ChatFoldersDialog
        open={foldersOpen}
        onOpenChange={setFoldersOpen}
        folders={folderList}
        chats={chats.data ?? []}
        busy={createFolder.isPending || updateFolder.isPending || deleteFolder.isPending}
        onCreate={(input) => createFolder.mutate(input)}
        onUpdate={(id, input) => updateFolder.mutate({ id, ...input })}
        onDelete={(id) => deleteFolder.mutate(id)}
      />

      {pollCreatorOpen && (
        <PollCreator
          onClose={() => setPollCreatorOpen(false)}
          onCreate={(input) => createPoll.mutate(input)}
          pending={createPoll.isPending}
        />
      )}

      {/* Подробная карточка собеседника (личный чат, Telegram-стиль). */}
      {peerCardOpen && isPrivate && activeChat && otherId && (
        <PeerInfoCard
          userId={otherId}
          online={otherOnline}
          blocked={activeChat.blocked}
          muted={activeChat.muted}
          onToggleBlock={() => block.mutate({ userId: otherId, blocked: activeChat.blocked })}
          onToggleMute={() => mute.mutate({ chatId: activeChat.id, muted: !activeChat.muted })}
          onClose={() => setPeerCardOpen(false)}
        />
      )}

      {blockedOpen && <BlockedUsersDialog onClose={() => setBlockedOpen(false)} />}

      {attachOpen && (
        <AttachmentDialog
          files={attachFiles}
          sending={false}
          onSend={(caption, spoiler) =>
            sendFiles({
              content: caption || undefined,
              replyToId: replyTo?.id,
              files: attachFiles,
              spoiler,
            })
          }
          onAddMore={() => fileInputRef.current?.click()}
          onRemove={(i) =>
            setAttachFiles((prev) => {
              const next = prev.filter((_, j) => j !== i)
              if (next.length === 0) setAttachOpen(false)
              return next
            })
          }
          onClose={() => {
            setAttachFiles([])
            setAttachOpen(false)
          }}
        />
      )}
    </div>
  )
}
