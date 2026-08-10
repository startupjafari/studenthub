'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  Copy,
  Download,
  Forward,
  Loader2,
  Mic,
  Ban,
  Eraser,
  ShieldBan,
  MoreVertical,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Reply,
  Search,
  Send,
  Trash2,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { useRealtimeSocket, useRealtimeEvent } from '../../../shared/realtime'
import {
  chatKeys,
  exportChatRequest,
  fetchChats,
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
  blockUserRequest,
  unblockUserRequest,
  clearChatRequest,
  deleteChatRequest,
  toggleReactionRequest,
  unpinMessageRequest,
  AttachmentDialog,
  ForwardDialog,
  MessageAttachments,
  MessageContent,
  MessageContextMenu,
  ReactionBar,
  SharedPostCard,
  VoiceWaveform,
  useVoiceRecorder,
  type ChatListItem,
  type ChatMemberInfo,
  type ChatMessage,
  type ChatTypeValue,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { GroupInfoDialog } from './group-info-dialog'
import { PeerInfoCard } from './peer-info-card'
import { BlockedUsersDialog } from './blocked-users-dialog'
import { CreateGroupDialog } from './create-group-dialog'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useChatListSlot, useMediaQuery, useSetChatOpen } from '../../../shared/lib'

const OFFICIAL_LABEL: Partial<Record<ChatTypeValue, string>> = {
  GROUP_OFFICIAL: 'typeGroupOfficial',
  FACULTY: 'typeFaculty',
  DEAN: 'typeDean',
  SUPPORT: 'typeSupport',
  SUBJECT: 'typeSubject',
}

function chatTitle(c: ChatListItem, t: (k: string) => string): string {
  if (c.title) return c.title
  if (c.subject) return c.subject
  const key = OFFICIAL_LABEL[c.type]
  return key ? t(key) : t('typePrivate')
}

function senderName(m: { sender: { firstName: string; lastName: string } }): string {
  return `${m.sender.lastName} ${m.sender.firstName}`.trim()
}

// ── Хелперы списка чатов (Telegram-стиль) ─────────────────────────────────────
function chatInitials(title: string): string {
  const parts = title.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '#'
}

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
]
function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? 'bg-sky-500'
}

// Тег-категория чата под превью (Telegram-стиль «папок»): i18n-ключ + приглушённая точка-цвет по типу.
const TYPE_TAG: Record<ChatTypeValue, { key: string; dot: string }> = {
  PRIVATE: { key: 'tagPrivate', dot: 'bg-sky-500' },
  GROUP: { key: 'tagGroup', dot: 'bg-indigo-500' },
  GROUP_OFFICIAL: { key: 'tagGroupOfficial', dot: 'bg-indigo-500' },
  SUBJECT: { key: 'tagSubject', dot: 'bg-emerald-500' },
  FACULTY: { key: 'tagFaculty', dot: 'bg-violet-500' },
  DEAN: { key: 'tagDean', dot: 'bg-amber-500' },
  SUPPORT: { key: 'tagSupport', dot: 'bg-rose-500' },
  EVENT: { key: 'tagEvent', dot: 'bg-teal-500' },
}

function listTime(iso: string, locale: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
}

export function ChatWindow() {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const socket = useRealtimeSocket()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const confirm = useConfirm()

  // Десктоп: список чатов порталим в слот сайдбара (см. AppSidebar chatsMode).
  // На мобильном слота нет — список остаётся во весь экран внутри main.
  const listSlot = useChatListSlot()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
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
  // Черновики по чатам: локально (мгновенно) + синхронизация с сервером (#3, дебаунс).
  const draftsRef = useRef<Map<string, string>>(new Map())
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [text, setText] = useState('')
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({})
  const [connected, setConnected] = useState(true)
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined)
  const [canLoadOlder, setCanLoadOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Ф9+: ответ, вложения, поиск.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  // Прикрепление файлов через диалог «Отправить как файл» (Telegram-стиль).
  const [attachFiles, setAttachFiles] = useState<File[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
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
  const [groupInfoOpen, setGroupInfoOpen] = useState(false)
  // Мини-карточка собеседника (личный чат, Telegram-стиль) — по клику на шапку.
  const [peerCardOpen, setPeerCardOpen] = useState(false)
  // Кнопка «вниз» + счётчик сообщений, пришедших пока пользователь пролистан вверх (Telegram-стиль).
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [newSinceScroll, setNewSinceScroll] = useState(0)
  // Режим множественного выбора сообщений (Telegram-стиль): чекбоксы + массовые действия.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Пересылка нескольких выбранных сообщений (id) — переиспользуем ForwardDialog.
  const [forwardIds, setForwardIds] = useState<string[] | null>(null)
  // Свайп-действия на строке списка чатов (мобильный): id открытой строки + учёт жеста.
  const [swipedChatId, setSwipedChatId] = useState<string | null>(null)
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
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
      // API отдаёт новые первыми — разворачиваем в хронологический порядок.
      return [...page.items].reverse()
    },
    enabled: !!activeId,
  })

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
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
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

  const mute = useMutation({
    mutationFn: ({ chatId, muted }: { chatId: string; muted: boolean }) =>
      setChatMutedRequest(chatId, muted),
    // Оптимистично переключаем флаг в кэше списка — мгновенная обратная связь в UI.
    onMutate: ({ chatId, muted }) => {
      const prev = qc.getQueryData<ChatListItem[]>(chatKeys.list())
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        (old ?? []).map((c) => (c.id === chatId ? { ...c, muted } : c)),
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
                    m.content || (m.media.length ? '[вложение]' : '')
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
      sendFiles.mutate({ content: undefined, replyToId: replyTo?.id, files: [file] })
      setReplyTo(null)
    },
    onError: (kind) =>
      toast.error(t(kind === 'unsupported' ? 'recordUnsupported' : 'recordDenied')),
  })

  const sendFiles = useMutation({
    mutationFn: (payload: { content?: string; replyToId?: string; files: File[] }) =>
      sendMessageWithAttachments(activeId as string, payload, payload.files),
    onSuccess: () => {
      setText('')
      setAttachFiles([])
      setAttachOpen(false)
      setReplyTo(null)
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

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

  // Индикатор связи + рефетч истории и повторный вход в комнату при реконнекте.
  useEffect(() => {
    if (!socket) return
    setConnected(socket.connected)
    const onConnect = (): void => {
      setConnected(true)
      if (activeId) {
        socket.emit('chat:join', { chatId: activeId })
        void qc.invalidateQueries({ queryKey: chatKeys.messages(activeId) })
      }
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
    }
    const onDisconnect = (): void => setConnected(false)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [socket, activeId, qc])

  // Входящие события — синхронизируем с кэшем React Query (docs/FRONTEND_RULES.md §8).
  useRealtimeEvent<{ message: ChatMessage; chatId: string }>(
    'message:new',
    ({ message, chatId }) => {
      if (chatId === activeId) {
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
          old && !old.some((m) => m.id === message.id) ? [...old, message] : (old ?? [message]),
        )
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
    const toBottom = (behavior: ScrollBehavior): void =>
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' })

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
      const prevHeight = el.scrollHeight
      void loadOlder().finally(() => {
        requestAnimationFrame(() => {
          const el2 = messagesScrollRef.current
          if (el2) el2.scrollTop = el2.scrollHeight - prevHeight
          loadingOlderRef.current = false
        })
      })
    }
  }

  function scrollToBottom(): void {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
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

  // ── Свайп по строке списка чатов (мобильный, Telegram-стиль) ──
  // Влево — плавно открыть действия (заглушить/удалить), следуя за пальцем; вправо по закрытой
  // строке — пометить чат прочитанным. Во время жеста трансформируем узел напрямую (без ре-рендера
  // ради плавности), на отпускании — доводим анимацией и синхронизируем состояние.
  const ROW_ACTIONS_W = 160 // ширина панели действий (две кнопки w-20 = 2×80px), совпадает с -translate-x-40
  const ROW_OPEN_THRESHOLD = 56
  const ROW_READ_THRESHOLD = 72

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
    const el = e.currentTarget
    chatSwipe.current = {
      id,
      startX: tch.clientX,
      startY: tch.clientY,
      moved: false,
      el,
      base: swipedChatId === id ? -ROW_ACTIONS_W : 0,
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
    // Резина за пределами хода: влево дальше панели и вправо (жест «прочитать») — с сопротивлением.
    if (x < -ROW_ACTIONS_W) x = -ROW_ACTIONS_W + (x + ROW_ACTIONS_W) * 0.35
    else if (x > 0) x *= 0.5
    setRowTransform(s.el, x, false)
  }
  function closeSwipedRow(id: string | null): void {
    if (id) setRowTransform(rowEls.current.get(id) ?? null, 0, true)
    setSwipedChatId((cur) => (cur === id ? null : cur))
  }
  function onRowTouchEnd(e: React.TouchEvent<HTMLElement>, id: string): void {
    const s = chatSwipe.current
    chatSwipe.current = null
    if (!s || !s.moved) return
    chatSwipedFlag.current = true
    const dx = (e.changedTouches[0]?.clientX ?? s.startX) - s.startX
    const wasOpen = s.base < 0
    // Правый свайп по закрытой строке дальше порога → пометить прочитанным (снап назад).
    if (!wasOpen && dx > ROW_READ_THRESHOLD) {
      setRowTransform(s.el, 0, true)
      markChatRead(id)
      return
    }
    const finalX = s.base + dx
    if (finalX < -ROW_OPEN_THRESHOLD) {
      // Открыть эту строку, соседнюю открытую — закрыть.
      if (swipedChatId && swipedChatId !== id)
        setRowTransform(rowEls.current.get(swipedChatId) ?? null, 0, true)
      setRowTransform(s.el, -ROW_ACTIONS_W, true)
      setSwipedChatId(id)
    } else {
      setRowTransform(s.el, 0, true)
      setSwipedChatId((cur) => (cur === id ? null : cur))
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
    if (!content || !socket) return
    // Не добавляем оптимистично: сервер эхом пришлёт message:new всем, включая нас — ровно один раз.
    socket.emit('message:send', { chatId: activeId, content, replyToId: replyTo?.id })
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
    const url = `${window.location.origin}/chats?c=${m.chatId}&m=${m.id}`
    void navigator.clipboard?.writeText(url)
    toast.success(t('linkCopied'))
  }

  // Скролл к сообщению + мягкая подсветка (Telegram-стиль).
  function focusMessage(messageId: string): void {
    const el = document.getElementById(`msg-${messageId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  function onMsgTouchStart(e: React.TouchEvent<HTMLLIElement>, m: ChatMessage): void {
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

  function onMsgTouchMove(e: React.TouchEvent<HTMLLIElement>): void {
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

  function onMsgTouchEnd(e: React.TouchEvent<HTMLLIElement>): void {
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

  const typingCount = Object.keys(typingUsers).length
  // Подпись «печатает…» для шапки (Telegram-стиль): в группе — с именем первого набирающего.
  const firstTyperId = Object.keys(typingUsers)[0]
  const firstTyperName = firstTyperId
    ? membersQuery.data?.find((u) => u.id === firstTyperId)?.firstName
    : undefined
  const activeChat = chats.data?.find((c) => c.id === activeId)
  const activeIsGroup = activeChat != null && activeChat.type !== 'PRIVATE'
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

  // Список чатов — на мобильном во весь экран; на десктопе порталится в сайдбар (embedded).
  const chatList = (
    <aside
      className={cn(
        embedded
          ? 'flex h-full w-full flex-col'
          : cn(
              // lg:hidden — на десктопе список всегда живёт в сайдбаре (портал); эта
              // inline-панель нужна только для мобильного/планшета (<lg). Так исключаем
              // «вторую» панель в момент, пока портал ещё не подхватил слот сайдбара.
              'w-full shrink-0 flex-col border-r border-border md:flex md:w-80 lg:hidden',
              activeId ? 'hidden md:flex' : 'flex',
            ),
      )}
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        {/* Заголовок: назад (десктоп) + «Чаты» + действия — одной строкой, кнопки одного размера. */}
        <div className="flex items-center gap-1.5">
          {embedded && (
            <button
              type="button"
              onClick={() => router.back()}
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
              onClick={() => setBlockedOpen(true)}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
            >
              <ShieldBan className="size-5" aria-hidden />
            </button>
            {/* Меню «+» — всплывающее окно рядом с кнопкой (позиционируется от неё). */}
            <div className="relative">
              <button
                type="button"
                aria-label={t('newChat')}
                onClick={() => setNewChatOpen((v) => !v)}
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
                  <div className="fixed inset-0 z-40" onClick={() => setNewChatOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-52 origin-top-right overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 slide-in-from-top-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateGroupOpen(true)
                        setNewChatOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <Users className="size-4 shrink-0 opacity-80" aria-hidden />
                      {t('newGroup')}
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
            value={listSearchRaw}
            onChange={(e) => setListSearchRaw(e.target.value)}
            placeholder={t('searchAll')}
            className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-8 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
          />
          {listSearchRaw && (
            <button
              type="button"
              aria-label={t('clearSearch')}
              onClick={() => {
                setListSearchRaw('')
                setListSearchTerm('')
              }}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {/* key вне embedded меняется при открытии/закрытии чата — список заново «въезжает»
            слева (анимация закрытия на мобильном); на десктопе key постоянный, скролл не сбрасывается. */}
      <div
        key={embedded ? 'list' : activeId ? 'list-hidden' : 'list-visible'}
        className={cn(
          'flex-1 overflow-y-auto',
          'duration-300 animate-in fade-in slide-in-from-left-4',
          // Инлайн-список (мобильный/планшет) — отступ снизу под фиксированную нижнюю навигацию + safe-area.
          !embedded && 'pb-[calc(6rem+env(safe-area-inset-bottom))]',
        )}
      >
        {listSearchTerm.length >= 2 ? (
          // Результаты единого поиска: сверху — чаты по названию, снизу — сообщения.
          <div className="flex flex-col">
            {chatMatches.length === 0 && msgMatches.length === 0 && !listMsgResults.isLoading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">{t('noResults')}</p>
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
                        ? lm.content || (lm.media.length ? t('attachment') : '')
                        : ''
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setActiveId(c.id)
                            setListSearchRaw('')
                            setListSearchTerm('')
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
                {(msgMatches.length > 0 || listMsgResults.isLoading) && (
                  <div className="flex flex-col">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('messagesSection')}
                    </p>
                    {listMsgResults.isLoading ? (
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
                              setActiveId(m.chatId)
                              setListSearchRaw('')
                              setListSearchTerm('')
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
        ) : chats.isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : list.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{t('noChats')}</p>
        ) : (
          list.map((c) => {
            const title = chatTitle(c, t)
            const lm = c.lastMessage
            const preview = lm ? lm.content || (lm.media.length ? t('attachment') : '') : ''
            const previewWho =
              lm && c.type !== 'PRIVATE'
                ? lm.senderId === myId
                  ? `${t('you')}: `
                  : `${lm.sender.firstName}: `
                : ''
            // Статус доставки последнего своего сообщения (Telegram-стиль ✓/✓✓ в списке).
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
                {/* Скрытые действия под строкой — открываются свайпом влево (только мобильный/планшет). */}
                <div className="absolute inset-y-0 right-0 z-0 flex lg:hidden">
                  <button
                    type="button"
                    aria-label={c.muted ? t('unmute') : t('mute')}
                    onClick={() => {
                      mute.mutate({ chatId: c.id, muted: !c.muted })
                      closeSwipedRow(c.id)
                    }}
                    className="flex w-20 flex-col items-center justify-center gap-1 whitespace-nowrap bg-muted px-1 text-center text-[0.6rem] font-medium leading-tight text-muted-foreground"
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
                      const msg =
                        c.type !== 'PRIVATE' && c.isOwner
                          ? t('deleteGroupConfirm')
                          : t('deleteChatConfirm')
                      closeSwipedRow(c.id)
                      void confirm({ title: msg, destructive: true }).then((ok) => {
                        if (ok) deleteChat.mutate(c.id)
                      })
                    }}
                    className="flex w-20 flex-col items-center justify-center gap-1 whitespace-nowrap bg-destructive px-1 text-center text-[0.6rem] font-medium leading-tight text-white"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t('delete')}
                  </button>
                </div>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) rowEls.current.set(c.id, el)
                    else rowEls.current.delete(c.id)
                  }}
                  onClick={() => {
                    // Свайп только что закрыл/открыл строку — клик игнорируем. Открытая строка → закрыть.
                    if (chatSwipedFlag.current) {
                      chatSwipedFlag.current = false
                      return
                    }
                    if (swipedChatId) {
                      closeSwipedRow(swipedChatId)
                      return
                    }
                    setActiveId(c.id)
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
                        className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-green-500"
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
                          <CheckCheck className="size-3 shrink-0 text-sky-500/80" aria-hidden />
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
                      {c.unreadCount > 0 && (
                        <span
                          className={cn(
                            'flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full px-1 text-[0.65rem] font-medium tabular-nums text-white',
                            c.muted ? 'bg-muted-foreground/60' : 'bg-primary',
                          )}
                        >
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
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
            <header
              className={cn(
                'flex items-center justify-between gap-1 border-b border-border px-3 py-3 md:px-4',
                selectMode && 'hidden',
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
                onClick={() => (isPrivate ? setPeerCardOpen(true) : setGroupInfoOpen(true))}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 text-left transition-colors hover:bg-muted"
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
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-green-500"
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
                {/* Действия — в меню «три точки». */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setHeaderMenuOpen((v) => !v)}
                    aria-label={t('messageActions')}
                    className={cn(
                      'relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
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
                            'flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-muted',
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
                          className="flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
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
                              'flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50',
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
                            className="flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-muted"
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
                            className="flex h-9 w-full items-center gap-2.5 px-3 text-sm text-destructive transition-colors hover:bg-destructive/10"
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
              <div
                ref={messagesScrollRef}
                onScroll={onMessagesScroll}
                className="flex-1 overflow-y-auto p-4"
              >
                {loadingOlder && (
                  <div className="mb-3 flex justify-center text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  </div>
                )}
                {messages.isLoading ? (
                  <div className="flex justify-center py-8 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {(messages.data ?? []).map((m, i) => {
                      const mine = m.senderId === myId
                      // Группировка подряд идущих сообщений одного автора (Telegram-стиль): аватар и имя —
                      // только у первого в серии; между сообщениями серии — плотнее, между авторами — просторнее.
                      const arr = messages.data ?? []
                      const prevMsg = arr[i - 1]
                      const firstOfRun = prevMsg?.senderId !== m.senderId
                      // Разделитель дня: перед первым сообщением и при смене календарного дня.
                      const showDay =
                        !prevMsg ||
                        new Date(prevMsg.createdAt).toDateString() !==
                          new Date(m.createdAt).toDateString()
                      return (
                        <Fragment key={m.id}>
                          {showDay && (
                            <li className="sticky top-1 z-10 my-2 flex justify-center">
                              <span className="rounded-full bg-muted/90 px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
                                {dayLabel(m.createdAt)}
                              </span>
                            </li>
                          )}
                          {unreadDividerId === m.id && (
                            <li className="my-2 flex items-center gap-2 px-1">
                              <span className="h-px flex-1 bg-primary/40" aria-hidden />
                              <span className="text-xs font-medium text-primary">
                                {t('unreadMessages')}
                              </span>
                              <span className="h-px flex-1 bg-primary/40" aria-hidden />
                            </li>
                          )}
                          <li
                            id={`msg-${m.id}`}
                            className={cn(
                              // -mx-4/px-4 — фон подсветки на всю ширину чата (в паддинг контейнера), высотой с сообщение.
                              // select-none + touch-action:pan-y — для тач-жестов (долгое нажатие / свайп-ответ).
                              'group relative -mx-4 flex touch-pan-y items-center gap-1.5 px-4 py-0.5 transition-colors duration-700 ease-in-out select-none',
                              i > 0 && (firstOfRun ? 'mt-2' : 'mt-0.5'),
                              mine && 'flex-row-reverse',
                              (highlightId === m.id || (selectMode && selectedIds.has(m.id))) &&
                                'bg-primary/10',
                              !selectMode && menu?.message.id === m.id && 'bg-primary/5',
                              selectMode && 'cursor-pointer',
                            )}
                            onContextMenu={
                              selectMode
                                ? undefined
                                : (e) => {
                                    e.preventDefault()
                                    setMenu({ message: m, x: e.clientX, y: e.clientY })
                                  }
                            }
                            onTouchStart={selectMode ? undefined : (e) => onMsgTouchStart(e, m)}
                            onTouchMove={selectMode ? undefined : onMsgTouchMove}
                            onTouchEnd={selectMode ? undefined : onMsgTouchEnd}
                          >
                            {selectMode && (
                              <>
                                {/* Оверлей ловит тап по всей строке → переключение выбора (внутренние клики не мешают). */}
                                <button
                                  type="button"
                                  aria-label={t('select')}
                                  onClick={() => toggleSelect(m.id)}
                                  className="absolute inset-0 z-20"
                                />
                                <span
                                  className={cn(
                                    'z-10 flex size-5 shrink-0 items-center justify-center rounded-full border',
                                    selectedIds.has(m.id)
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-muted-foreground/40',
                                  )}
                                >
                                  {selectedIds.has(m.id) && (
                                    <Check className="size-3.5" aria-hidden />
                                  )}
                                </span>
                              </>
                            )}
                            {!mine &&
                              (firstOfRun ? (
                                <ProfileLink userId={m.senderId} className="shrink-0 self-end">
                                  <Avatar className="size-7">
                                    <AvatarFallback>
                                      {(m.sender.lastName[0] ?? '') + (m.sender.firstName[0] ?? '')}
                                    </AvatarFallback>
                                  </Avatar>
                                </ProfileLink>
                              ) : (
                                // Спейсер сохраняет горизонтальное место аватара — пузыри серии остаются выровненными.
                                <span className="size-7 shrink-0" aria-hidden />
                              ))}
                            <div
                              data-bubble
                              className={cn(
                                'relative max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                                mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                              )}
                            >
                              {/* Быстрая кнопка «Ответить» при наведении (Telegram-стиль). У своих — слева
                              (справа мешает скроллбар), у чужих — справа; всегда со стороны к центру. */}
                              <button
                                type="button"
                                aria-label={t('reply')}
                                onClick={() => setReplyTo(m)}
                                className={cn(
                                  'absolute -top-2 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100',
                                  mine ? '-left-2' : '-right-2',
                                )}
                              >
                                <Reply className="size-3.5" aria-hidden />
                              </button>
                              {!mine && firstOfRun && (
                                <p className="mb-0.5 text-xs font-medium opacity-70">
                                  <ProfileLink userId={m.senderId} className="hover:underline">
                                    {senderName(m)}
                                  </ProfileLink>
                                </p>
                              )}
                              {m.replyTo && (
                                <button
                                  type="button"
                                  onClick={() => m.replyTo && focusMessage(m.replyTo.id)}
                                  className={cn(
                                    'mb-1 block w-full rounded-md border-l-2 py-0.5 pl-2 text-left text-xs transition-colors',
                                    mine
                                      ? 'border-primary-foreground/50 opacity-80 hover:bg-primary-foreground/10'
                                      : 'border-primary/50 opacity-75 hover:bg-primary/10',
                                  )}
                                >
                                  <span className="font-medium">{senderName(m.replyTo)}</span>
                                  <p className="line-clamp-2">
                                    {m.replyTo.content || t('attachment')}
                                  </p>
                                </button>
                              )}
                              {m.forwardedFrom && (
                                <p className="mb-0.5 flex items-center gap-1 text-xs italic opacity-70">
                                  <Forward className="size-3" aria-hidden />
                                  {t('forwardedFrom', { name: senderName(m.forwardedFrom) })}
                                </p>
                              )}
                              {/* Медиа/вложения сверху, подпись — всегда снизу (как в Telegram). */}
                              {m.media.length > 0 && (
                                <MessageAttachments
                                  media={m.media}
                                  mine={mine}
                                  viewerMeta={{
                                    senderName: senderName(m),
                                    createdAt: m.createdAt,
                                    mine,
                                    caption: m.content,
                                  }}
                                  viewerActions={{
                                    onGoTo: () => focusMessage(m.id),
                                    onCopy: () => copyText(m),
                                    onForward: () => setForwardMsg(m),
                                    onDelete: () => deleteMessage(m),
                                  }}
                                />
                              )}
                              {m.sharedPost && (
                                <div className={cn(m.media.length > 0 && 'mt-1')}>
                                  <SharedPostCard post={m.sharedPost} />
                                </div>
                              )}
                              {m.content && (
                                <div className={cn((m.media.length > 0 || m.sharedPost) && 'mt-1')}>
                                  <MessageContent content={m.content} />
                                </div>
                              )}
                              <span
                                className={cn(
                                  'mt-0.5 flex items-center gap-1 text-[0.65rem]',
                                  mine ? 'justify-end' : 'justify-start',
                                )}
                              >
                                {m.pinnedAt && <Pin className="size-2.5 opacity-60" aria-hidden />}
                                <span className="opacity-60">
                                  {new Date(m.createdAt).toLocaleTimeString(locale, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  {m.editedAt && ` · ${t('edited')}`}
                                </span>
                                {mine &&
                                  (() => {
                                    const read =
                                      readWatermark != null &&
                                      new Date(readWatermark).getTime() >=
                                        new Date(m.createdAt).getTime()
                                    // #6: в группах у прочитанного сообщения показываем, сколько прочитали.
                                    const count =
                                      read && activeIsGroup ? readByCount(m.createdAt) : 0
                                    if (read)
                                      return (
                                        <span
                                          className="flex items-center gap-0.5"
                                          title={
                                            count > 0 ? t('readByCount', { count }) : undefined
                                          }
                                        >
                                          <CheckCheck
                                            className="size-3.5 text-sky-300"
                                            aria-hidden
                                          />
                                          {count > 0 && (
                                            <span className="text-[10px] leading-none opacity-70">
                                              {count}
                                            </span>
                                          )}
                                        </span>
                                      )
                                    if (onlineOthers > 0)
                                      return (
                                        <CheckCheck className="size-3.5 opacity-60" aria-hidden />
                                      )
                                    return <Check className="size-3.5 opacity-60" aria-hidden />
                                  })()}
                              </span>
                              <ReactionBar
                                reactions={m.reactions}
                                myId={myId}
                                onToggle={(emoji) => react.mutate({ messageId: m.id, emoji })}
                              />
                            </div>
                            {/* Кнопка-шеврон открывает контекстное меню (как в Telegram) */}
                            <button
                              type="button"
                              aria-label={t('messageActions')}
                              onClick={(e) => {
                                const r = e.currentTarget.getBoundingClientRect()
                                setMenu({ message: m, x: r.left, y: r.bottom })
                              }}
                              className="flex size-6 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                            >
                              <ChevronDown className="size-4" aria-hidden />
                            </button>
                          </li>
                        </Fragment>
                      )
                    })}
                  </ul>
                )}
                <div ref={bottomRef} />
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

            {/* Панель правки */}
            {editing && (
              <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-2 text-xs">
                <Pencil className="size-3.5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{t('editing')}</span>
                  <p className="line-clamp-1 text-muted-foreground">{editing.content}</p>
                </div>
                <button
                  type="button"
                  aria-label={t('cancelReply')}
                  onClick={() => {
                    setEditing(null)
                    setText('')
                  }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            )}

            {/* Панель ответа */}
            {replyTo && !editing && (
              <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-2 text-xs">
                <Reply className="size-3.5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">
                    {t('replyingTo', { name: senderName(replyTo) })}
                  </span>
                  <p className="line-clamp-1 text-muted-foreground">
                    {replyTo.content || t('attachment')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t('cancelReply')}
                  onClick={() => setReplyTo(null)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            )}

            {blockedActive ? (
              <div className="flex items-center justify-center gap-2 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-muted-foreground">
                <Ban className="size-4 shrink-0" aria-hidden />
                <span>{activeChat?.blocked ? t('blockedBanner') : t('blockedByBanner')}</span>
                {activeChat?.blocked && otherId && (
                  <button
                    type="button"
                    onClick={() => block.mutate({ userId: otherId, blocked: true })}
                    className="font-medium text-primary hover:underline"
                  >
                    {t('unblockUser')}
                  </button>
                )}
              </div>
            ) : (
              <div className="relative flex items-center gap-1.5 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {/* Попап @-упоминаний участников */}
                {mentionCandidates.length > 0 && !voice.recording && (
                  <div className="absolute bottom-full left-3 z-20 mb-1 max-h-56 w-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
                    {mentionCandidates.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => insertMention(u)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <Avatar className="size-7 shrink-0">
                          <AvatarFallback className="text-xs">
                            {(u.lastName[0] ?? '') + (u.firstName[0] ?? '')}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate">
                          {u.lastName} {u.firstName}
                          {u.id === myId ? ` (${t('you')})` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                {voice.recording ? (
                  // Строка записи: отмена · таймер + волны · пауза/продолжить · отправить
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('cancelRecording')}
                      onClick={voice.cancel}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-5" aria-hidden />
                    </Button>
                    <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-input px-3">
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full bg-destructive',
                          !voice.paused && 'animate-pulse',
                        )}
                        aria-hidden
                      />
                      <span className="w-10 shrink-0 tabular-nums text-sm text-muted-foreground">
                        {recMMSS}
                      </span>
                      <VoiceWaveform analyserRef={voice.analyserRef} paused={voice.paused} />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={voice.paused ? t('resumeRecording') : t('pauseRecording')}
                      onClick={voice.paused ? voice.resume : voice.pause}
                    >
                      {voice.paused ? (
                        <Play className="size-5" aria-hidden />
                      ) : (
                        <Pause className="size-5" aria-hidden />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      aria-label={t('send')}
                      loading={sendFiles.isPending}
                      onClick={voice.finish}
                    >
                      <Send className="size-4" aria-hidden />
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={t('attach')}
                      disabled={!connected || !!editing}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      <Paperclip className="size-5" aria-hidden />
                    </button>
                    <input
                      ref={composerRef}
                      value={text}
                      onChange={(e) => onType(e.target.value)}
                      onKeyDown={(e) => {
                        // Открыт попап упоминаний: Enter — выбрать первого, Escape — закрыть.
                        if (mentionCandidates.length > 0) {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const first = mentionCandidates[0]
                            if (first) insertMention(first)
                            return
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setMentionQuery(null)
                            return
                          }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          send()
                        }
                      }}
                      placeholder={t('messagePlaceholder')}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                    />
                    {showSend ? (
                      <Button
                        type="button"
                        size="icon"
                        aria-label={t('send')}
                        loading={sendFiles.isPending}
                        disabled={!connected}
                        onClick={send}
                      >
                        <Send className="size-4" aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t('recordVoice')}
                        disabled={!connected}
                        onClick={() => void voice.start()}
                      >
                        <Mic className="size-5" aria-hidden />
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </section>

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

      {groupInfoOpen && activeChat && (
        <GroupInfoDialog
          chatId={activeChat.id}
          title={chatTitle(activeChat, t)}
          avatarUrl={activeChat.avatarUrl}
          isOwner={activeChat.isOwner}
          isAdmin={activeChat.isAdmin}
          muted={activeChat.muted}
          myId={myId}
          onClose={() => setGroupInfoOpen(false)}
          onToggleMute={() => mute.mutate({ chatId: activeChat.id, muted: !activeChat.muted })}
          onLeft={() => {
            setGroupInfoOpen(false)
            setActiveId(null)
          }}
          onOpenChat={(id) => {
            setGroupInfoOpen(false)
            setActiveId(id)
          }}
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
          sending={sendFiles.isPending}
          onSend={(caption) =>
            sendFiles.mutate({
              content: caption || undefined,
              replyToId: replyTo?.id,
              files: attachFiles,
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
