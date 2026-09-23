'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Forward,
  List as ListIcon,
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
import { CHAT_FOLDER_LIMITS, type CreateChatPollInput } from '@studenthub/shared-schemas'
import { directoryKeys, fetchUserDirectory } from '../../../entities/user'
import { useAppSelector } from '../../../shared/store'
import { useRealtimeSocket, useRealtimeEvent } from '../../../shared/realtime'
import {
  chatKeys,
  exportChatFile,
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
  sendMessageWithUploaded,
  presignChatAttachment,
  startChatAttachmentMultipart,
  chatAttachmentPartUrls,
  setChatMutedRequest,
  setChatPinnedRequest,
  setChatArchivedRequest,
  scheduleMessageRequest,
  sortChats,
  blockUserRequest,
  unblockUserRequest,
  clearChatRequest,
  fetchChatMediaCalendar,
  createChatRequest,
  deleteChatRequest,
  acceptChatRequestRequest,
  declineChatRequestRequest,
  toggleReactionRequest,
  unpinMessageRequest,
  AttachmentDialog,
  ALBUM_MAX_ITEMS,
  compressImages,
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
  type AttachmentSendOptions,
  type MessageAttachment,
  type MessageMenuAnchor,
} from '../../../entities/chat'
import {
  needsDirectUpload,
  needsMultipartUpload,
  putPresigned,
  uploadResumable,
} from '../../../shared/api'
import { latestSeqOf, mergeUpdates } from '../lib/merge-updates'
import { ChatDetailsPanel } from './chat-details-panel'
import { ChatFoldersDialog } from './chat-folders-dialog'
import { MessageItem, type MessageActions, type MessageReadState } from './message-item'
import { ChatComposer } from './chat-composer'
import { PollCreator } from './poll-creator'
import { BlockedUsersDialog } from './blocked-users-dialog'
import { CreateGroupDialog } from './create-group-dialog'
import { ScheduleSendDialog } from './schedule-send-dialog'
import { ScheduledPanel } from './scheduled-panel'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DateJumpPicker,
  formatYmd,
  MenuSeparator,
  Modal,
  RowContextMenu,
  Skeleton,
  useConfirm,
  type RichTextHandle,
} from '../../../shared/ui'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import { cn } from '../../../shared/lib/utils'
import {
  createSpring,
  formatBytes,
  hapticTick,
  isOversizeOnPick,
  maxUploadBytes,
  prefersReducedMotion,
  rubberband,
  saveFile,
  useChatListSlot,
  useMediaQuery,
  useByteUnitLabel,
  useSetChatOpen,
  useSwipeRows,
} from '../../../shared/lib'

import { ConversationList } from './conversation-list'
import {
  avatarColor,
  chatInitials,
  chatTitle,
  isOfficialChat,
  listTime,
  senderName,
} from '../lib/format'
import { buildFolderTabs, filterChatsByTab, folderTabLabel } from '../lib/folders'

// Сколько человек показывать в секции «Люди» единой строки поиска.
const PEOPLE_IN_SEARCH = 20

/**
 * Вложение не влезло в лимит категории. Отдельный тип, потому что сообщение об этом
 * называет файл и его предел, а не переводится по коду ошибки сервера.
 */
class OversizeAttachmentError extends Error {
  constructor(readonly file: File) {
    super('attachment is too large')
  }
}

/** Что уходит одной multipart-отправкой: поля сообщения + сами файлы. */
interface UploadPayload {
  content?: string
  replyToId?: string
  replyQuote?: string
  files: File[]
  /** Номера вложений под спойлером внутри этой пачки. */
  spoilerIndexes?: number[]
  asFiles?: boolean
  silent?: boolean
}

/** Фото и видео уходят превью-плитками, всё остальное — строками файла. */
function isMediaFile(f: File): boolean {
  return f.type.startsWith('image/') || f.type.startsWith('video/')
}

/** Разрезать вложения по потолку одного сообщения. Пустой список даёт пустой результат. */
function chunkFiles(files: File[]): File[][] {
  const out: File[][] = []
  for (let i = 0; i < files.length; i += ALBUM_MAX_ITEMS)
    out.push(files.slice(i, i + ALBUM_MAX_ITEMS))
  return out
}

// Ширина одной кнопки свайп-панели строки списка (w-[4.5rem]).
const ROW_BTN_W = 72

// Фокус в поле ввода при открытии чата: редактор создаётся после монтирования, поэтому
// попыток несколько. Полсекунды — с запасом на медленный первый кадр, дальше пробовать
// бессмысленно: значит, поля на экране нет (входящая заявка, блокировка).
const FOCUS_RETRY_MS = 50
const FOCUS_TRIES = 10

/** Пустая карта набирающих: общая ссылка, чтобы отсутствие набора не перерисовывало ленту. */
const NO_TYPING: Record<string, number> = {}

// Сколько закреплений полоса показывает шкалой. Дальше деления тоньше волоса и читаются
// как сплошная линия — там честнее число «3/12».
const PINNED_SCALE_MAX = 6

// Высота пометки дня в потоке ленты: строка 20 px + вертикальные отступы my-2 (8+8).
// По ней понимаем, ушла ли пометка под верх — тогда её подменяет прилипший заголовок.
const DAY_LABEL_H = 36

// Скелетон ленты сообщений: форма будущих пузырей (FRONTEND_RULES §13 — загрузка показывается
// скелетоном, а не спиннером), чередование «чужой/свой» и разная ширина.
const MESSAGE_SKELETONS = [
  { mine: false, size: 'h-10 w-48' },
  { mine: true, size: 'h-14 w-56' },
  { mine: false, size: 'h-10 w-36' },
  { mine: true, size: 'h-10 w-44' },
  { mine: false, size: 'h-20 w-52' },
  { mine: true, size: 'h-10 w-32' },
]

// Иконочные кнопки шапок чата (обычная, поиск, выбор сообщений) — одна геометрия на все три
// режима: 44 px под палец (§13) и 40 px под курсор, иконка внутри size-5. Раньше в одном ряду
// стояли кнопки 32 и 36 px, и шапка читалась как собранная из разных наборов.
const HEADER_ICON_BTN =
  'flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:size-10'

/**
 * Подсветка совпавшего фрагмента в превью результата поиска. Первое вхождение, без
 * регистра: строка превью короткая, а подсвечивать все вхождения в двух строках —
 * пестрота, из которой уже не видно самого текста.
 */
function highlightTerm(text: string, term: string): React.ReactNode {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
        {text.slice(at, at + term.length)}
      </mark>
      {text.slice(at + term.length)}
    </>
  )
}

export function ChatWindow() {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const unitLabel = useByteUnitLabel()
  const tRoles = useTranslations('Roles')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
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
  /**
   * Кто сейчас набирает, по чатам: `{ chatId: { userId: когда пришло событие } }`.
   *
   * Карта по всем чатам, а не только по открытому: подпись «печатает» нужна и в строке списка
   * (§1 карты интерфейса), а события теперь приходят в личную комнату по всем чатам, где
   * состоит смотрящий, а не только по открытому.
   */
  const [typingByChat, setTypingByChat] = useState<Record<string, Record<string, number>>>({})
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
  // Процитированный фрагмент отвечаемого сообщения: заполняется, если в момент нажатия
  // «Ответить» внутри этого сообщения был выделен текст (Telegram-стиль).
  const [replyQuote, setReplyQuote] = useState<string | null>(null)
  // «Без звука» — залипающий переключатель у кнопки отправки, сбрасывается при смене чата.
  const [silentSend, setSilentSend] = useState(false)
  // Диалог «отправить позже» и панель уже отложенных сообщений этого чата.
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduledOpen, setScheduledOpen] = useState(false)
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
  /**
   * Полоса закреплённого спрятана «до следующего раза» (§2 карты): помним набор закреплений,
   * который прятали. Изменился набор — подсказка снова нужна и полоса возвращается. Набор,
   * а не «самое новое»: сервер отдаёт закреплённые списком без обещания порядка, и по одному
   * его краю «появилось новое» не отличить от «сняли старое».
   */
  const [pinnedHiddenKey, setPinnedHiddenKey] = useState<string | null>(null)
  // Меню полосы закреплённого (правый клик) и окно со списком всех закреплений чата.
  const [pinnedMenu, setPinnedMenu] = useState<{ x: number; y: number } | null>(null)
  const [pinnedListOpen, setPinnedListOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Время, до которого другие участники прочитали чат — для статусов ✓/✓✓ своих сообщений.
  const [readWatermark, setReadWatermark] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null)
  const [presence, setPresence] = useState<Record<string, boolean>>({})
  // Telegram-стиль: контекстное меню сообщения и режим правки.
  const [menu, setMenu] = useState<{
    message: ChatMessage
    x: number
    y: number
    // Выделение снимаем при ОТКРЫТИИ меню: клик по пункту «Ответить» его уже сбросит,
    // и читать window.getSelection() позже поздно.
    selection: string | null
    // Пузырь под пальцем — только у долгого нажатия: на телефоне меню строится вокруг него.
    anchor?: MessageMenuAnchor
  } | null>(null)
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
  // Список совпадений под строкой поиска. Открыт, пока не выбрали конкретное сообщение:
  // шагать по совпадениям вслепую стрелками — это и есть «неудобно», когда их два десятка.
  const [searchListOpen, setSearchListOpen] = useState(true)
  const searchJumpedFor = useRef<string | null>(null)
  // Фильтр «От кого» (§4): id+имя выбранного автора (или null — все).
  const [searchFrom, setSearchFrom] = useState<{ id: string; name: string } | null>(null)
  const [searchFromOpen, setSearchFromOpen] = useState(false)
  // Докнутая правая панель деталей (десктоп ≥xl): профиль/участники/медиа без ухода из чата.
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Кнопка «вниз» + счётчик сообщений, пришедших пока пользователь пролистан вверх (Telegram-стиль).
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [newSinceScroll, setNewSinceScroll] = useState(0)
  // Плавающий заголовок даты (Telegram-стиль §6): дата верхнего видимого сообщения, гаснет вне скролла.
  const [floatingDay, setFloatingDay] = useState<string | null>(null)
  const [floatingDayShown, setFloatingDayShown] = useState(false)
  // Режим множественного выбора сообщений (Telegram-стиль): чекбоксы + массовые действия.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Пересылка нескольких выбранных сообщений (id) — переиспользуем ForwardDialog.
  const [forwardIds, setForwardIds] = useState<string[] | null>(null)
  // Свайп-действия на строке списка чатов (мобильный): вправо — «Прочитать · Закрепить»,
  // влево — «Без звука · Архив · Удалить». Жест и его физика — общий хук shared/lib
  // (та же механика у списка уведомлений).
  // Долгое нажатие по строке открывает её меню. Жест — в том же хуке, что и свайп (он один
  // видит движение пальца и умеет отменять удержание), а меню — состояние списка, поэтому хук
  // зовёт обработчик через ref, который список туда кладёт.
  const rowLongPressRef = useRef<((id: string, el: HTMLElement) => void) | null>(null)
  const chatRows = useSwipeRows({
    leftWidth: 2 * ROW_BTN_W, // Прочитать + Закрепить
    rightWidth: 3 * ROW_BTN_W, // Без звука + Архив + Удалить
    onLongPress: (id, el) => rowLongPressRef.current?.(id, el),
  })

  // Возврат из чата к списку: панель списка не монтируется заново (она всегда в дереве),
  // поэтому «появление» ей даём флагом — на время анимации, а потом снимаем, иначе список
  // въезжал бы при каждой перерисовке.
  const [listReturning, setListReturning] = useState(false)
  const prevActiveId = useRef(activeId)
  useEffect(() => {
    const had = prevActiveId.current
    prevActiveId.current = activeId
    // Только переход «чат был → чата нет»: при первом открытии экрана списку ехать неоткуда.
    if (activeId || !had) return
    setListReturning(true)
    const timer = window.setTimeout(() => setListReturning(false), 320)
    return () => window.clearTimeout(timer)
  }, [activeId])

  // Разделитель «Непрочитанные»: снимок кол-ва непрочитанных при открытии + id первого непрочитанного.
  const [openUnread, setOpenUnread] = useState(0)
  const [unreadDividerId, setUnreadDividerId] = useState<string | null>(null)
  const chatsRef = useRef<ChatListItem[] | undefined>(undefined)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  // Высота плавающего композера: он лежит поверх ленты, поэтому столько же пустоты держим
  // под последним сообщением. Высота живая (панель ответа, многострочный текст, запись
  // голосового) — следим ResizeObserver'ом, а не считаем один раз.
  const [composerH, setComposerH] = useState(0)
  const composerRO = useRef<ResizeObserver | null>(null)
  const setComposerBox = useCallback((el: HTMLDivElement | null) => {
    composerRO.current?.disconnect()
    composerRO.current = null
    if (!el) {
      setComposerH(0)
      return
    }
    const ro = new ResizeObserver(() => setComposerH(el.offsetHeight))
    ro.observe(el)
    composerRO.current = ro
    setComposerH(el.offsetHeight)
  }, [])
  useEffect(() => () => composerRO.current?.disconnect(), [])
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
  const composerRef = useRef<RichTextHandle>(null)
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

  /**
   * Открыли чат — курсор сразу в поле ввода: чат открывают, чтобы писать, и лишний клик
   * по полю перед каждым сообщением ничем не оправдан.
   *
   * Только на десктопе. На телефоне автофокус поднимает экранную клавиатуру на пол-экрана
   * и закрывает ровно те сообщения, ради которых чат и открыли; там поле фокусируют
   * касанием, когда собираются писать.
   *
   * Не один вызов в следующем кадре, а несколько попыток: редактор создаётся уже после
   * монтирования (`immediatelyRender: false` в RichTextField), и при открытии чата с нуля
   * первая попытка приходится на момент, когда фокусировать ещё нечего.
   */
  useEffect(() => {
    if (!activeId || !isDesktop) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      const handle = composerRef.current
      handle?.focus()
      if (handle || tries >= FOCUS_TRIES) clearInterval(timer)
    }, FOCUS_RETRY_MS)
    return () => clearInterval(timer)
  }, [activeId, isDesktop])

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

  // Люди своего вуза — в той же выдаче, что чаты и сообщения (Telegram-стиль): отдельного
  // входа «написать человеку» нет, переписка начинается прямо из строки поиска.
  // Не больше двадцати строк: люди стоят между чатами и сообщениями, и полная выдача
  // увела бы секцию «Сообщения» далеко за пределы экрана.
  const listPeopleResults = useQuery({
    queryKey: directoryKeys.search(listSearchTerm, PEOPLE_IN_SEARCH),
    queryFn: () => fetchUserDirectory(listSearchTerm, PEOPLE_IN_SEARCH),
    enabled: listSearchTerm.length >= 2,
  })

  // Клик по человеку: находим/заводим личный чат и открываем его. Запрос на переписку
  // не-другу (§50) это ещё не отправляет — он уйдёт с первым сообщением (см. requestWaiting).
  const startDirect = useMutation({
    mutationFn: (userId: string) => createChatRequest({ type: 'PRIVATE', memberIds: [userId] }),
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      setListSearchRaw('')
      setListSearchTerm('')
      setActiveId(chat.id)
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Поиск внутри чата (§3): дебаунс запроса + результаты по активному чату.
  useEffect(() => {
    const term = chatSearchRaw.trim()
    const id = setTimeout(() => {
      setChatSearchTerm(term.length >= 2 ? term : '')
      // Новый запрос — снова показываем список: выбор прошлого запроса к нему не относится.
      setSearchListOpen(true)
    }, 300)
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

  /**
   * Пересылка (§5 карты): выбранные сообщения уходят в каждый отмеченный чат, следом за ними —
   * подпись «от себя» отдельным сообщением. Последовательно и через await, а не пачкой мутаций:
   * подпись обязана прийти ПОСЛЕ пересланного, иначе комментарий стоит раньше того, что
   * комментирует. Своего поля для подписи у `POST /chats/:id/forward` нет — отсюда второе
   * сообщение, а не изменение контракта.
   */
  async function sendForward(
    targetChatIds: string[],
    messageIds: string[],
    caption: string,
  ): Promise<void> {
    try {
      for (const targetChatId of targetChatIds) {
        for (const messageId of messageIds) {
          await forwardMessageRequest(targetChatId, messageId)
        }
        if (caption) await sendMessageWithAttachments(targetChatId, { content: caption }, [])
      }
      setForwardMsg(null)
      toast.success(t('forwarded'))
    } catch (e) {
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    }
  }

  /** «Избранное» как цель пересылки: чат может ещё не существовать — заводим по требованию. */
  async function resolveSavedChatId(): Promise<string> {
    const existing = (chats.data ?? []).find((c) => c.type === 'SAVED')
    if (existing) return existing.id
    const { id } = await fetchSavedChat()
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
    return id
  }

  // Создание опроса (§38): сообщение-опрос придёт по WS message:new — оптимистично не добавляем.
  const createPoll = useMutation({
    mutationFn: (input: CreateChatPollInput) => createChatPoll(activeId as string, input),
    onSuccess: () => setPollCreatorOpen(false),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Пользовательские папки чатов (§2): вкладки списка. Держим здесь, потому что список чатов
  // порталится в сайдбар и своего состояния не имеет.
  const [foldersOpen, setFoldersOpen] = useState(false)
  // Папка, на которой диалог должен открыться («Настроить папку» из меню вкладки).
  const [foldersEditId, setFoldersEditId] = useState<string | null>(null)
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
  // Правка папки применяется к кэшу сразу: галочку в меню строки жмут и смотрят на неё же,
  // и ожидание ответа читалось бы как «не нажалось». Ответ сервера всё равно перезапросим.
  const updateFolder = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; chatIds?: string[] }) =>
      updateChatFolderRequest(id, input),
    onMutate: async ({ id, ...input }) => {
      await qc.cancelQueries({ queryKey: chatKeys.folders() })
      const previous = qc.getQueryData<ChatFolder[]>(chatKeys.folders())
      qc.setQueryData<ChatFolder[]>(chatKeys.folders(), (old) =>
        old?.map((f) => (f.id === id ? { ...f, ...input } : f)),
      )
      return { previous }
    },
    onError: (e, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(chatKeys.folders(), ctx.previous)
      folderError(e)
    },
    onSettled: invalidateFolders,
  })

  // Переключить чат в папке из меню строки: состав папки уходит целиком, как его и ждёт API.
  const toggleChatFolder = (folderId: string, chatId: string): void => {
    const folder = folderList.find((f) => f.id === folderId)
    if (!folder) return
    const inside = folder.chatIds.includes(chatId)
    if (!inside && folder.chatIds.length >= CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER) {
      toast.error(t('foldersLimitChats', { max: CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER }))
      return
    }
    updateFolder.mutate({
      id: folderId,
      chatIds: inside ? folder.chatIds.filter((id) => id !== chatId) : [...folder.chatIds, chatId],
    })
  }
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
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        // pinnedAt проставляем вместе с флагом: по нему идёт сортировка (sortChats),
        // и без него только что закреплённый чат уехал бы в конец закреплённых.
        sortChats(
          (old ?? []).map((c) =>
            c.id === chatId
              ? { ...c, pinned, pinnedAt: pinned ? new Date().toISOString() : null }
              : c,
          ),
        ),
      )
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

  // Запрос на переписку (§50): решение адресата. Принятие оставляет чат открытым — он
  // просто уезжает из вкладки «Запросы» в общий список; отказ удаляет чат, поэтому
  // закрываем и переписку.
  const acceptRequest = useMutation({
    mutationFn: (chatId: string) => acceptChatRequestRequest(chatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('requestAccepted'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const declineRequest = useMutation({
    mutationFn: (chatId: string) => declineChatRequestRequest(chatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      setActiveId(null)
      toast.success(t('requestDeclined'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Отложенная отправка: текст из композера уходит в очередь, а не в чат.
  const schedule = useMutation({
    mutationFn: ({ chatId, scheduledAt }: { chatId: string; scheduledAt: string }) =>
      scheduleMessageRequest(chatId, {
        content: text.trim(),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(replyTo && replyQuote ? { replyQuote } : {}),
        silent: silentSend,
        scheduledAt,
      }),
    onSuccess: (_d, { chatId }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.scheduled(chatId) })
      setScheduleOpen(false)
      setText('')
      setReplyTo(null)
      setReplyQuote(null)
      toast.success(t('scheduleDone'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Архив «у себя»: чат уезжает в отдельную вкладку и перестаёт считаться в бейдже.
  const archive = useMutation({
    mutationFn: ({ chatId, archived }: { chatId: string; archived: boolean }) =>
      setChatArchivedRequest(chatId, archived),
    onMutate: ({ chatId, archived }) => {
      const prev = qc.getQueryData<ChatListItem[]>(chatKeys.list())
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        (old ?? []).map((c) => (c.id === chatId ? { ...c, archived } : c)),
      )
      // Открытый чат уезжает во вкладку «Архив» — держать его раскрытым сбивает с толку.
      if (archived) setActiveId((cur) => (cur === chatId ? null : cur))
      return { prev }
    },
    onSuccess: (_d, { archived }) =>
      toast.success(archived ? t('archivedDone') : t('unarchivedDone')),
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatKeys.list(), ctx.prev)
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
    },
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

  /**
   * Очистка истории за период (§5 карты, режим диапазона в календаре). Скрытие «у себя»:
   * у остальных участников переписка остаётся целой — чужие сообщения не удаляют.
   * Календарь тоже инвалидируем: снимки очищенных дней из него должны уйти.
   */
  const clearPeriod = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      clearChatRequest(activeId as string, {
        // Границы включительны: сервер сравнивает по createdAt, поэтому конец —
        // последняя миллисекунда выбранного дня, а не его полночь.
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59.999`).toISOString(),
      }),
    onSuccess: () => {
      if (!activeId) return
      void qc.invalidateQueries({ queryKey: chatKeys.messages(activeId) })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      void qc.invalidateQueries({ queryKey: ['chats', activeId, 'media-calendar'] })
      toast.success(t('historyCleared'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  /**
   * Миниатюры для календаря: грузим ровно тот месяц, который открыт. Пока попап закрыт,
   * месяца нет и запроса тоже — календарь открывают редко, а окно у него всегда одно.
   */
  const [calendarMonth, setCalendarMonth] = useState<string | null>(null)
  const calendarMedia = useQuery({
    queryKey: chatKeys.mediaCalendar(activeId ?? '', calendarMonth ?? ''),
    queryFn: () => {
      const [y, m] = (calendarMonth as string).split('-').map(Number)
      const from = new Date(y as number, (m as number) - 1, 1)
      const to = new Date(y as number, m as number, 0, 23, 59, 59, 999)
      return fetchChatMediaCalendar(activeId as string, from.toISOString(), to.toISOString())
    },
    enabled: !!activeId && !!calendarMonth,
    staleTime: 5 * 60 * 1000,
  })
  const dayThumbs = useMemo(() => {
    const out: Record<string, string> = {}
    for (const it of calendarMedia.data ?? []) out[it.day] = it.url
    return out
  }, [calendarMedia.data])

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => deleteChatRequest(chatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      setActiveId(null)
      toast.success(t('chatDeleted'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Файл собирает сервер: в нём шапка с происхождением выгрузки (кто, когда, из какой
  // системы) и единое имя по шаблону платформы. Браузер такой файл собрать не мог —
  // он не знает ни домена, ни версии, ни таймзоны вуза.
  const exportChat = useMutation({
    mutationFn: (format: 'txt' | 'json') => exportChatFile(activeId as string, format, locale),
    onSuccess: saveFile,
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
      sendFiles({ replyToId: replyTo?.id, files: [file], silent: silentSend })
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
  // Прерыватели загрузок: сообщение уходит одним multipart-запросом, значит и отменяется
  // он целиком. Ключ — tempId оптимистичного пузыря, крестик на котором нажали.
  const uploadAborts = useRef(new Map<string, AbortController>())
  const mediaRetry = useRef<
    Map<
      string,
      {
        chatId: string
        content?: string
        replyToId?: string
        files: File[]
        spoilerIndexes?: number[]
        asFiles?: boolean
      }
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

  /**
   * Прямая загрузка вложений в хранилище с последующей отправкой сообщения по ключам (Ф19.0).
   *
   * Прогресс агрегируется по всем файлам сразу: пользователь отправил одно сообщение и ждёт
   * одну полосу, а не пять по очереди. Вес файлов при этом разный, поэтому доля считается по
   * байтам, а не по числу готовых файлов — иначе стомегабайтный ролик и стокилобайтная
   * картинка двигали бы полосу одинаково.
   */
  async function uploadDirectAttachments(
    tempId: string,
    chatId: string,
    fields: Omit<UploadPayload, 'files'>,
    files: File[],
    signal: AbortSignal,
  ): Promise<ChatMessage> {
    const total = files.reduce((sum, f) => sum + f.size, 0)
    const sent = new Map<number, number>()
    const report = (): void => {
      let done = 0
      for (const value of sent.values()) done += value
      setUploadProgress(chatId, tempId, total > 0 ? Math.min(1, done / total) : 0)
    }

    const attachments: {
      key: string
      uploadId?: string
      name?: string
      spoiler?: boolean
      parts?: { part: number; etag: string }[]
    }[] = []

    // Последовательно, а не параллельно: внутри многочастной загрузки и так три части в
    // работе, и запускать пять таких одновременно значит забить канал и замедлить всё.
    for (const [i, file] of files.entries()) {
      const spoiler = fields.spoilerIndexes?.includes(i)
      const onProgress = (f: number): void => {
        sent.set(i, f * file.size)
        report()
      }

      if (needsMultipartUpload(file.size)) {
        const parts: { part: number; etag: string }[] = []
        const target = await uploadResumable<{ key: string; uploadId: string }>({
          file,
          bucket: 'CHAT',
          start: (mime, size) => startChatAttachmentMultipart(chatId, mime, size),
          urls: (range) => chatAttachmentPartUrls(chatId, range),
          // Сборку делает сервер на отправке сообщения — она же привязывает файл к пузырю.
          // Отдельным шагом объект собрался бы раньше сообщения и остался сиротой, если бы
          // отправка не дошла.
          complete: async (input) => {
            parts.push(...input.parts)
            return { key: input.key, uploadId: input.uploadId }
          },
          onProgress,
          signal,
        })
        attachments.push({
          key: target.key,
          uploadId: target.uploadId,
          name: file.name,
          spoiler,
          parts,
        })
      } else {
        const presigned = await presignChatAttachment(
          chatId,
          file.type || 'application/octet-stream',
        )
        await putPresigned(presigned.url, file, onProgress, signal)
        attachments.push({ key: presigned.key, name: file.name, spoiler })
      }
      sent.set(i, file.size)
      report()
    }

    return sendMessageWithUploaded(chatId, {
      content: fields.content,
      replyToId: fields.replyToId,
      replyQuote: fields.replyQuote,
      silent: fields.silent,
      asFiles: fields.asFiles,
      attachments,
    })
  }

  async function uploadFiles(
    tempId: string,
    chatId: string,
    payload: UploadPayload,
  ): Promise<void> {
    const { files, ...fields } = payload
    const abort = new AbortController()
    uploadAborts.current.set(tempId, abort)
    setSendState((s) => ({ ...s, [tempId]: 'pending' }))
    try {
      // Сжимаем здесь, а не перед показом пузыря: пузырь уже висит в ленте с локальным
      // превью, и ждать ради него пережатия одиннадцати снимков незачем. «Без сжатия» —
      // единственный режим, где байты уходят ровно те, что выбрали.
      const payloadFiles = fields.asFiles ? files : await compressImages(files)
      // Повторная проверка размера уже по итоговым байтам: при выборе снимок мерился самым
      // мягким лимитом, потому что сжатие ещё впереди, — здесь видно, помогло ли оно.
      const oversize = payloadFiles.find((f) => f.size > maxUploadBytes(f.type))
      if (oversize) {
        throw new OversizeAttachmentError(oversize)
      }
      // Крупные вложения через API не проходят: тело multipart-запроса целиком ложится в
      // память процесса. Хоть один такой файл — и всё сообщение уходит прямым путём, потому
      // что сообщение создаётся одним запросом, и делить его между двумя путями некуда.
      const real = payloadFiles.some((f) => needsDirectUpload(f.size))
        ? await uploadDirectAttachments(tempId, chatId, fields, payloadFiles, abort.signal)
        : await sendMessageWithAttachments(
            chatId,
            fields,
            payloadFiles,
            (f) => setUploadProgress(chatId, tempId, f),
            abort.signal,
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
      pendingMedia.current = pendingMedia.current.filter((p) => p.tempId !== tempId)
      // Отменил сам пользователь — пузырь уже убран, и ни ошибки, ни предложения повторить
      // быть не должно: он именно этого и добивался.
      if (abort.signal.aborted) return
      // Загрузка не удалась — помечаем пузырь ошибкой, оставляем для повтора (клик по значку).
      setSendState((s) => ({ ...s, [tempId]: 'failed' }))
      setUploadProgress(chatId, tempId, 0)
      if (e instanceof OversizeAttachmentError) {
        warnOversize(e.file)
      } else {
        toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
      }
    } finally {
      uploadAborts.current.delete(tempId)
    }
  }

  /**
   * Отмена загрузки по крестику: рвём запрос и убираем пузырь совсем.
   *
   * Именно убираем, а не оставляем «не отправлено» с предложением повторить: отмену нажимают,
   * когда файл улетел не в тот чат или не тот файл, и висящий после этого пузырь с кнопкой
   * «ещё раз» предлагает ровно то, от чего отказались.
   */
  function cancelUpload(m: ChatMessage): void {
    const tempId = m.id
    uploadAborts.current.get(tempId)?.abort()
    uploadAborts.current.delete(tempId)
    mediaRetry.current.delete(tempId)
    const pending = pendingMedia.current.find((p) => p.tempId === tempId)
    pendingMedia.current = pendingMedia.current.filter((p) => p.tempId !== tempId)
    // Локальные превью больше не нужны — освобождаем, иначе объекты висят до перезагрузки.
    for (const url of pending?.localUrls ?? []) URL.revokeObjectURL(url)
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(m.chatId), (old) =>
      (old ?? []).filter((x) => x.id !== tempId),
    )
    setSendState((s) => {
      const next = { ...s }
      delete next[tempId]
      return next
    })
  }

  function sendFiles(payload: {
    content?: string
    replyToId?: string
    replyQuote?: string
    files: File[]
    spoilerIndexes?: number[]
    asFiles?: boolean
    silent?: boolean
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
      spoiler: payload.spoilerIndexes?.includes(i),
      asDocument: payload.asFiles,
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
      replyQuote: payload.replyQuote ?? null,
      silent: payload.silent ?? false,
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
      spoilerIndexes: payload.spoilerIndexes,
      asFiles: payload.asFiles,
    })
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) => [...(old ?? []), temp])
    // Сбрасываем композер/диалог сразу — как в Telegram (пузырь уже в ленте, грузится в фоне).
    setText('')
    setAttachFiles([])
    setAttachOpen(false)
    setReplyTo(null)
    void uploadFiles(tempId, chatId, {
      content: payload.content,
      replyToId: payload.replyToId,
      replyQuote: payload.replyQuote,
      files: payload.files,
      spoilerIndexes: payload.spoilerIndexes,
      asFiles: payload.asFiles,
      silent: payload.silent,
    })
  }

  /**
   * Отправка выбранных вложений выбранным в диалоге способом.
   *
   * Альбом режется на стопки по {@link ALBUM_MAX_ITEMS} — столько вложений несёт одно
   * сообщение; без группировки каждый снимок уходит своим. Подпись, ответ и цитата достаются
   * только первому сообщению: отвечают один раз, а повторённая у одиннадцати снимков подпись
   * превратилась бы в одиннадцать одинаковых строк подряд.
   */
  function sendAttachments(caption: string, options: AttachmentSendOptions): void {
    const files = attachFiles
    if (files.length === 0) return
    const media = files.filter(isMediaFile)
    const docs = files.filter((f) => !isMediaFile(f))
    // Как файлы уходит всё вместе списком; иначе медиа собирается по правилу группировки,
    // а документы, выбранные заодно со снимками, идут своей пачкой.
    const batches: File[][] = options.asFiles
      ? chunkFiles(files)
      : [...(options.grouped ? chunkFiles(media) : media.map((f) => [f])), ...chunkFiles(docs)]

    // Спойлеры выбраны по снимкам, а уходят пачками — номер считается внутри своей пачки.
    const spoilered = new Set(options.spoilered)
    batches.forEach((batch, i) => {
      sendFiles({
        content: i === 0 ? caption || undefined : undefined,
        replyToId: i === 0 ? replyTo?.id : undefined,
        // Цитата и «без звука» действуют и на сообщение с вложениями: это свойства
        // отправки, а не текста.
        replyQuote: i === 0 ? (replyQuote ?? undefined) : undefined,
        files: batch,
        spoilerIndexes: batch.flatMap((f, j) => (spoilered.has(f) ? [j] : [])),
        asFiles: options.asFiles,
        silent: silentSend,
      })
    })
  }

  // Вход/выход из комнаты чата при смене активного чата.
  useEffect(() => {
    if (!socket || !activeId) return
    socket.emit('chat:join', { chatId: activeId })
    setReplyTo(null)
    setReplyQuote(null)
    setSilentSend(false)
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
    if (userId === myId) return
    setTypingByChat((prev) => ({ ...prev, [chatId]: { ...prev[chatId], [userId]: Date.now() } }))
  })
  useRealtimeEvent<{ chatId: string; userId: string }>('typing:stopped', ({ chatId, userId }) => {
    setTypingByChat((prev) => {
      const inChat = prev[chatId]
      if (!inChat || !(userId in inChat)) return prev
      const rest = { ...inChat }
      delete rest[userId]
      const next = { ...prev }
      if (Object.keys(rest).length === 0) delete next[chatId]
      else next[chatId] = rest
      return next
    })
  })

  // Автоочистка «печатает» через 4с без обновления. Нужна не только от потерянного
  // `typing:stopped`: набирающий мог закрыть вкладку, и подпись висела бы вечно — в строке
  // списка это заметнее, чем в шапке, потому что туда никто не заходит её сбрасывать.
  useEffect(() => {
    const timer = setInterval(() => {
      setTypingByChat((prev) => {
        const now = Date.now()
        const next: Record<string, Record<string, number>> = {}
        let changed = false
        for (const [chatId, users] of Object.entries(prev)) {
          const alive: Record<string, number> = {}
          for (const [uid, ts] of Object.entries(users)) if (now - ts < 4000) alive[uid] = ts
          if (Object.keys(alive).length !== Object.keys(users).length) changed = true
          if (Object.keys(alive).length > 0) next[chatId] = alive
        }
        return changed ? next : prev
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
    // Мини-карточку собеседника закрывать больше нечем: её заменила вкладка «Профиль»
    // в панели деталей, а панель перемонтируется по key={chat.id} и сама открывается
    // на первой вкладке.
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
      if (last) emitRead(activeId, last.id)
      return
    }

    if (last && last.id !== prevLastId) {
      if (last.senderId === myId || nearBottom()) {
        toBottom('smooth')
        emitRead(activeId, last.id)
      } else {
        setNewSinceScroll((n) => n + 1)
        setShowScrollDown(true)
      }
    }
  }, [messages.data, activeId, socket, myId])

  // Панель ввода выросла (открылся ответ, текст в несколько строк, запись голосового):
  // место под неё увеличилось, и стоявшего внизу человека надо там же и удержать — иначе
  // последнее сообщение уезжает под панель.
  useEffect(() => {
    if (!wasAtBottomRef.current) return
    const el = messagesScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [composerH])

  // Начальная пометка дня: лента открывается внизу, и до первого скролла обработчик
  // не сработает — без этого заголовок дня появлялся бы только после касания колеса.
  useEffect(() => {
    const data = messages.data
    if (!data || data.length === 0) {
      setFloatingDay(null)
      return
    }
    const last = data[data.length - 1]
    if (last) {
      setFloatingDay(dayLabel(last.createdAt))
      // Чат открывается у последнего сообщения: пометка его дня осталась выше кадра
      // (если сообщений за день больше одного) — показываем заголовок сразу.
      const first = data[0]
      setFloatingDayShown(
        !!first &&
          new Date(first.createdAt).toDateString() !== new Date(last.createdAt).toDateString(),
      )
    }
    // Пересчёт при смене чата и подгрузке истории; дальше день ведёт onMessagesScroll.
  }, [activeId, messages.data])

  // Скролл ленты: показ кнопки «вниз», отметка прочтения при доскролле вниз, авто-догрузка старых у верха.
  function onMessagesScroll(): void {
    const el = messagesScrollRef.current
    if (!el) return
    // Пометка дня (§6). Она живёт в потоке ленты, перед первым сообщением дня, и
    // прокручивается вместе с ним. Прилипший заголовок наверху — её подмена на время,
    // пока сама пометка уехала под верх: тогда дата всё равно видна, а когда пометка
    // возвращается в кадр, заголовок гаснет, чтобы не было двух одинаковых дат.
    // (Настоящий `position: sticky` не годится: virtua оборачивает каждое сообщение,
    // и прилипало бы в пределах одного сообщения, а не до следующей даты.)
    const vh = virtualizerRef.current
    const data = messages.data
    if (vh && data && data.length > 0) {
      const topIdx = Math.min(Math.max(vh.findItemIndex(vh.scrollOffset), 0), data.length - 1)
      const top = data[topIdx]
      if (top) {
        setFloatingDay(dayLabel(top.createdAt))
        const prev = data[topIdx - 1]
        const startsDay =
          !prev ||
          new Date(prev.createdAt).toDateString() !== new Date(top.createdAt).toDateString()
        // Насколько верхнее сообщение уже ушло под верх: пока меньше высоты пометки,
        // она видна целиком и подменять её нечем.
        const scrolledInto = vh.scrollOffset - vh.getItemOffset(topIdx)
        setFloatingDayShown(!startsDay || scrolledInto > DAY_LABEL_H)
      }
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setShowScrollDown(!atBottom)
    if (atBottom && !wasAtBottomRef.current) {
      setNewSinceScroll(0)
      const last = messages.data?.[messages.data.length - 1]
      if (last && socket && activeId) emitRead(activeId, last.id)
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

  /**
   * «Открыть без прочтения» (§4 карты): чат открыт, но отметка о прочтении наружу не уходит
   * и счётчик непрочитанного остаётся. Флаг — ref, а не состояние: его читают обработчики
   * прокрутки и приёма сообщений, и лишняя перерисовка ленты на каждое переключение ни к чему.
   * Снимается при уходе из чата — вернувшись в него обычным способом, человек его и прочитал.
   */
  const peekChatIdRef = useRef<string | null>(null)
  // Сравнение с активным чатом, а не очистка в размонтировании эффекта: пункт меню сначала
  // ставит флаг и лишь потом переключает чат, и «снять при уходе» стёрло бы его на том же клике.
  useEffect(() => {
    if (peekChatIdRef.current && peekChatIdRef.current !== activeId) peekChatIdRef.current = null
  }, [activeId])
  /** Единая точка отправки отметки о прочтении: молчит, пока чат открыт «без прочтения». */
  function emitRead(chatId: string, messageId: string): void {
    if (peekChatIdRef.current === chatId) return
    socket?.emit('message:read', { chatId, messageId })
  }

  function markChatRead(chatId: string): void {
    const chat = (qc.getQueryData<ChatListItem[]>(chatKeys.list()) ?? []).find(
      (c) => c.id === chatId,
    )
    if (!chat || chat.unreadCount === 0) return
    const lastId = chat.lastMessage?.id
    // Явное «прочитать» снимает режим подглядывания: человек сам сказал, что прочёл.
    if (peekChatIdRef.current === chatId) peekChatIdRef.current = null
    if (socket && lastId) socket.emit('message:read', { chatId, messageId: lastId })
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
      (old ?? []).map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)),
    )
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
  function emitSend(
    chatId: string,
    nonce: string,
    content: string,
    replyToId?: string,
    opts: { replyQuote?: string; silent?: boolean } = {},
  ): void {
    const tempId = `tmp:${nonce}`
    setSendState((s) => ({ ...s, [tempId]: 'pending' }))
    socket?.emit('message:send', {
      chatId,
      content,
      replyToId,
      // Цитата без ответа схемой запрещена — шлём только парой.
      ...(replyToId && opts.replyQuote ? { replyQuote: opts.replyQuote } : {}),
      ...(opts.silent ? { silent: true } : {}),
      nonce,
    })
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
      void uploadFiles(m.id, media.chatId, {
        content: media.content,
        replyToId: media.replyToId,
        files: media.files,
        spoilerIndexes: media.spoilerIndexes,
        asFiles: media.asFiles,
      })
      return
    }
    emitSend(m.chatId, m.id.slice(4), m.content, m.replyToId ?? undefined, {
      replyQuote: m.replyQuote ?? undefined,
      silent: m.silent,
    })
  }

  function send(): void {
    const content = text.trim()
    if (!activeId) return
    // Режим правки: редактируем существующее сообщение (сервер эхом пришлёт message:updated).
    if (editing) {
      if (content && socket) socket.emit('message:edit', { messageId: editing.id, content })
      setEditing(null)
      setText('')
      composerRef.current?.focus()
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
      replyQuote: replyQuote,
      silent: silentSend,
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
    emitSend(activeId, nonce, content, replyTo?.id, {
      replyQuote: replyQuote ?? undefined,
      silent: silentSend,
    })
    socket.emit('typing:stop', { chatId: activeId })
    setText('')
    draftsRef.current.delete(activeId)
    // #3: отправили — гасим серверный черновик (и локальный таймер сохранения).
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    void saveChatDraft(activeId, '').catch(() => undefined)
    setReplyTo(null)
    setReplyQuote(null)
    setMentionQuery(null)
    // Отправка с Enter фокус и не теряет, а вот клик по кнопке уводит его на кнопку —
    // и следующее сообщение приходится начинать с клика по полю.
    composerRef.current?.focus()
  }

  // ── Обработчики контекстного меню сообщения (Telegram-стиль) ────────────────
  /**
   * Начать ответ. Если внутри отвечаемого сообщения выделен фрагмент — он становится
   * цитатой (Telegram-стиль): в длинном учебном вопросе важно показать, на какую именно
   * часть отвечаешь. Выделение читаем ДО закрытия меню — клик по пункту его сбрасывает.
   */
  function startReply(m: ChatMessage, quote?: string | null): void {
    setReplyTo(m)
    const trimmed = quote?.trim() ?? ''
    // Цитата длиннее самого сообщения смысла не имеет, как и цитата во всё сообщение.
    setReplyQuote(trimmed && trimmed !== m.content.trim() ? trimmed.slice(0, 500) : null)
  }

  // Выделенный пользователем текст внутри конкретного сообщения; пусто — выделения нет
  // или оно вне этого сообщения (иначе цитировали бы кусок соседнего пузыря).
  function selectionWithin(messageId: string): string | null {
    if (typeof window === 'undefined') return null
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    // getElementById, а не querySelector: у оптимистичных пузырей id вида `tmp:...`,
    // и двоеточие сломало бы CSS-селектор.
    const host = document.getElementById(`msg-${messageId}`)
    if (!host) return null
    const range = sel.getRangeAt(0)
    return host.contains(range.commonAncestorContainer) ? sel.toString() : null
  }

  function startEdit(m: ChatMessage): void {
    setEditing(m)
    setReplyTo(null)
    setReplyQuote(null)
    setText(m.content)
  }

  function deleteMessage(m: ChatMessage): void {
    if (socket) socket.emit('message:delete', { messageId: m.id })
  }

  // Копирование снимка в буфер делает сам просмотрщик; наше дело — сказать, вышло или нет.
  function onCopiedImage(ok: boolean): void {
    if (ok) toast.success(t('copiedImage'))
    else toast.error(tErr('INTERNAL_ERROR'))
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
    // Порог ответа уже пересечён — чтобы тактильный тик сработал ровно один раз.
    reachedReply: boolean
  } | null>(null)

  function resetBubble(bubble: HTMLElement | null, animate: boolean): void {
    if (!bubble) return
    bubble.style.transition = 'none'
    if (!animate || prefersReducedMotion()) {
      bubble.style.transform = ''
      return
    }
    // Возврат пружиной от текущего экранного положения: фиксированные 150ms ease стартовали
    // от логического значения и на быстром жесте давали заметный рывок.
    const m = /translateX\((-?[\d.]+)px\)/.exec(bubble.style.transform)
    const from = m ? Number(m[1]) : 0
    if (from === 0) return
    const spring = createSpring({
      from,
      damping: 1,
      response: 0.3,
      onChange: (v) => {
        bubble.style.transform = v ? `translateX(${v}px)` : ''
      },
    })
    spring.to(0)
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
      // Геометрию снимаем ПОСЛЕ сброса сдвига: меню строится вокруг пузыря на его законном
      // месте, а не там, куда его успел утащить начатый свайп.
      const r = s.bubble?.getBoundingClientRect()
      setMenu({
        message: m,
        x,
        y,
        selection: selectionWithin(m.id),
        anchor:
          s.bubble && r
            ? {
                node: s.bubble,
                rect: { top: r.top, left: r.left, width: r.width, height: r.height },
              }
            : undefined,
      })
      hapticTick()
    }, LONG_PRESS_MS)
    msgTouch.current = {
      m,
      startX: x,
      startY: y,
      bubble,
      timer,
      longFired: false,
      swiping: false,
      reachedReply: false,
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
      // За порогом ответа пузырь не встаёт колом (было `Math.min(dx, 72)` — палец едет,
      // пузырь стоит, и жест читается как «заело»), а сопротивляется всё сильнее: §9.
      const shift =
        dx <= SWIPE_REPLY_PX
          ? dx
          : SWIPE_REPLY_PX + rubberband(dx - SWIPE_REPLY_PX, s.bubble?.offsetWidth ?? 240)
      if (s.bubble) {
        s.bubble.style.transition = 'none'
        s.bubble.style.transform = `translateX(${shift}px)`
      }
      // Один тик ровно в момент пересечения порога — палец узнаёт, что отпускать уже можно,
      // не глядя на экран (§13: обратная связь на причинном событии, а не в конце).
      if (!s.reachedReply && dx > SWIPE_REPLY_PX) {
        s.reachedReply = true
        hapticTick()
      } else if (s.reachedReply && dx <= SWIPE_REPLY_PX) {
        s.reachedReply = false
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

  /**
   * Открыть меню от указателя (правый клик на ПК, кнопка-шеврон). Долгое нажатие сюда не
   * ходит: у него есть якорь-пузырь, и меню оно ставит само.
   *
   * Android поверх нашего долгого нажатия шлёт ещё и `contextmenu` — без этой заглушки второе
   * открытие затирало бы якорь, и меню прыгало бы к точке касания без снимка сообщения.
   */
  function openMenuAt(m: ChatMessage, x: number, y: number): void {
    if (msgTouch.current?.longFired) return
    setMenu({ message: m, x, y, selection: selectionWithin(m.id) })
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
    // Определяем @-запрос перед курсором для автодополнения упоминаний. Текст до
    // курсора берём у самого поля: значение `v` — это markdown всего сообщения, и по
    // нему позиция курсора не восстанавливается.
    const before = composerRef.current?.textBefore() ?? v
    const m = before.match(/(?:^|\s)@(\S*)$/)
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
    const handle = composerRef.current
    const name = `${u.firstName} ${u.lastName}`.trim()
    const before = handle?.textBefore() ?? ''
    // Стираем сам «@запрос» перед курсором — вместе с собакой.
    const typed = /(?:^|\s)@(\S*)$/.exec(before)
    handle?.insertText(`@${name} `, typed ? (typed[1]?.length ?? 0) + 1 : 0)
    setMentionQuery(null)
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
  /**
   * Сообщить, что файл не влезает в лимит своей категории, и назвать сам лимит: «больше»
   * без числа оставляет человека гадать, до скольки сжимать.
   */
  function warnOversize(file: File): void {
    toast.error(
      t('attachTooLarge', {
        name: file.name,
        max: formatBytes(maxUploadBytes(file.type), unitLabel),
      }),
    )
  }

  function addFiles(list: FileList | null): void {
    const arr = Array.from(list ?? [])
    if (arr.length === 0) return
    // Отсекаем неподъёмное сразу при выборе: иначе файл сначала уезжал на сервер целиком и
    // только там получал 413 — полминуты ожидания ради ошибки.
    const accepted = arr.filter((f) => {
      if (!isOversizeOnPick(f)) return true
      warnOversize(f)
      return false
    })
    if (accepted.length === 0) return
    setAttachFiles((prev) => (attachOpen ? [...prev, ...accepted] : accepted))
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

  // Ctrl/⌘+F в открытом чате ищет по переписке, а не по странице браузера: искать
  // «где это было» браузерным поиском бессмысленно — в DOM только видимый кусок ленты
  // (виртуализация). Перехватываем только когда чат открыт и фокус не в поле ввода.
  useEffect(() => {
    if (!activeId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'f' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing && !chatSearchOpen) return
      e.preventDefault()
      setChatSearchOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, chatSearchOpen])

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

  // Выбор совпадения из списка: прыгаем к нему и убираем список — дальше человек
  // читает переписку вокруг найденного, а не выдачу.
  function pickSearchResult(index: number): void {
    const items = chatSearchResults.data?.items ?? []
    const m = items[index]
    if (!m) return
    setSearchIdx(index)
    setSearchListOpen(false)
    void jumpToMessage(m.id)
  }

  // Шаг по совпадениям: dir=+1 — старее (следующее), -1 — новее (предыдущее). Прыгаем к сообщению.
  function stepSearch(dir: 1 | -1): void {
    const items = chatSearchResults.data?.items ?? []
    if (items.length === 0) return
    const next = Math.min(Math.max(searchIdx + dir, 0), items.length - 1)
    setSearchIdx(next)
    setSearchListOpen(false)
    const m = items[next]
    if (m) void jumpToMessage(m.id)
  }

  function closeChatSearch(): void {
    setChatSearchOpen(false)
    setChatSearchRaw('')
    setChatSearchTerm('')
    setSearchIdx(0)
    setSearchListOpen(true)
    setSearchFrom(null)
    setSearchFromOpen(false)
    searchJumpedFor.current = null
  }

  const typingUsers = (activeId ? typingByChat[activeId] : undefined) ?? NO_TYPING
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
  // Вкладки папок для окна пересылки: те же, что над списком чатов, но готовым составом —
  // сам диалог живёт в entities и о папках знать не может (слои FSD).
  const forwardTabs = useMemo(
    () =>
      buildFolderTabs(list, folderList).map((tab) => ({
        id: tab.id,
        label: folderTabLabel(tab, t),
        chatIds: tab.id === 'folderAll' ? null : filterChatsByTab(list, tab).map((c) => c.id),
      })),
    [list, folderList, t],
  )

  const pinnedKey = pinnedList.map((p) => p.id).join(',')
  const pinnedHidden = pinnedHiddenKey !== null && pinnedHiddenKey === pinnedKey
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
  // Запрос на переписку ушёл и ждёт ответа — поле ввода закрывает плашка. Уходит запрос
  // первым сообщением, поэтому до него поле открыто. Пока запрос висит, писать может
  // только инициатор, так что любое сообщение в чате — его: lastMessage хватает, пока
  // лента не загрузилась, а лента — сразу после отправки, до обновления списка чатов.
  const requestWaiting =
    !!activeChat?.requestOutgoing && (!!activeChat.lastMessage || (messages.data?.length ?? 0) > 0)
  // Тост «запрос отправлен» — в момент, когда запрос правда ушёл: в этом же чате ожидания не
  // было и появилось. Смотрим на переход, а не на отправку, потому что путей у первого
  // сообщения несколько (текст, медиа, голос). Смена чата — не переход: открыть чат с уже
  // висящим запросом не значит отправить его снова.
  const requestWaitingRef = useRef<{ chatId: string | null; waiting: boolean }>({
    chatId: null,
    waiting: false,
  })
  useEffect(() => {
    const prev = requestWaitingRef.current
    if (prev.chatId === activeId && !prev.waiting && requestWaiting) toast.success(t('requestSent'))
    requestWaitingRef.current = { chatId: activeId, waiting: requestWaiting }
  }, [activeId, requestWaiting, t])

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
        peerId: otherId ?? undefined,
        peerBlocked: activeChat.blocked,
        onToggleBlock: otherId
          ? () => block.mutate({ userId: otherId, blocked: activeChat.blocked })
          : undefined,
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
    startReply,
    selection: selectionWithin,
    setMenu,
    openMenuAt,
    setForwardMsg,
    focusMessage,
    copyText,
    deleteMessage,
    retrySend,
    cancelUpload,
    toggleSelect,
    enterSelect,
    onCopiedImage,
    react,
    onMsgTouchStart,
    onMsgTouchMove,
    onMsgTouchEnd,
  })
  msgHandlersRef.current = {
    setReplyTo,
    startReply,
    selection: selectionWithin,
    setMenu,
    openMenuAt,
    setForwardMsg,
    focusMessage,
    copyText,
    deleteMessage,
    retrySend,
    cancelUpload,
    toggleSelect,
    enterSelect,
    onCopiedImage,
    react,
    onMsgTouchStart,
    onMsgTouchMove,
    onMsgTouchEnd,
  }
  const messageActions = useMemo<MessageActions>(
    () => ({
      reply: (m) => msgHandlersRef.current.startReply(m, msgHandlersRef.current.selection(m.id)),
      openMenu: (m, x, y) => msgHandlersRef.current.openMenuAt(m, x, y),
      focus: (id) => msgHandlersRef.current.focusMessage(id),
      copy: (m) => msgHandlersRef.current.copyText(m),
      forward: (m) => msgHandlersRef.current.setForwardMsg(m),
      del: (m) => msgHandlersRef.current.deleteMessage(m),
      retry: (m) => msgHandlersRef.current.retrySend(m),
      cancelUpload: (m) => msgHandlersRef.current.cancelUpload(m),
      toggleSelect: (id) => msgHandlersRef.current.toggleSelect(id),
      startSelect: (m) => msgHandlersRef.current.enterSelect(m),
      copiedImage: (ok) => msgHandlersRef.current.onCopiedImage(ok),
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
      onManageFolders={() => {
        setFoldersEditId(null)
        setFoldersOpen(true)
      }}
      onToggleChatFolder={(folderId, chat) => toggleChatFolder(folderId, chat.id)}
      onEditFolder={(folderId) => {
        setFoldersEditId(folderId)
        setFoldersOpen(true)
      }}
      onDeleteFolder={(folder) => {
        void confirm({
          title: t('foldersDeleteConfirm', { name: folder.name }),
          destructive: true,
        }).then((ok) => {
          if (ok) deleteFolder.mutate(folder.id)
        })
      }}
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
      peopleMatches={listPeopleResults.data?.items ?? []}
      peopleLoading={listPeopleResults.isLoading}
      onOpenPerson={(u) => startDirect.mutate(u.id)}
      startingPersonId={startDirect.isPending ? (startDirect.variables ?? null) : null}
      chatById={chatById}
      chats={list}
      chatsLoading={chats.isLoading}
      myId={myId}
      locale={locale}
      returning={listReturning}
      swiped={chatRows.swiped}
      swipedFlagRef={chatRows.swipedFlagRef}
      longPressedRef={chatRows.longPressedRef}
      longPressRef={rowLongPressRef}
      rowElsRef={chatRows.rowElsRef}
      onRowTouchStart={chatRows.onRowTouchStart}
      onRowTouchMove={chatRows.onRowTouchMove}
      onRowTouchEnd={chatRows.onRowTouchEnd}
      onCloseSwiped={chatRows.closeRow}
      typingByChat={typingByChat}
      onMarkRead={markChatRead}
      onOpenInNewTab={(c) => {
        // Тот же адрес, что и у «Написать» из профиля (?chat=<id>) — второе окно открывается
        // готовым на нужной переписке, а не на списке.
        window.open(`${pathname}?chat=${c.id}`, '_blank', 'noopener')
      }}
      onOpenUnread={(c) => {
        peekChatIdRef.current = c.id
        setActiveId(c.id)
      }}
      onClearHistory={(c) => {
        void confirm({ title: t('clearHistoryConfirm'), destructive: true }).then((ok) => {
          if (ok) clearChat.mutate(c.id)
        })
      }}
      onTogglePin={(c) => pin.mutate({ chatId: c.id, pinned: !c.pinned })}
      onToggleMute={(c) => mute.mutate({ chatId: c.id, muted: !c.muted })}
      onToggleArchive={(c) => archive.mutate({ chatId: c.id, archived: !c.archived })}
      onDeleteChat={(c) => {
        const msg =
          c.type !== 'PRIVATE' && c.isOwner ? t('deleteGroupConfirm') : t('deleteChatConfirm')
        void confirm({ title: msg, destructive: true }).then((ok) => {
          if (ok) deleteChat.mutate(c.id)
        })
      }}
    />
  )

  // «Заблокировать / Разблокировать» из меню «три точки» в шапке. Красный пункт только в роли
  // «Заблокировать», поэтому место у него разное: блокировка — в опасной группе за линией,
  // снятие блокировки — среди обычных пунктов.
  const headerBlockItem =
    isPrivate && otherId && activeChat ? (
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
    ) : null

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
              <header className="flex items-center gap-1 border-b border-border px-2 py-3 duration-200 animate-in fade-in slide-in-from-top-2">
                <button
                  type="button"
                  aria-label={t('cancel')}
                  onClick={exitSelect}
                  className={cn(HEADER_ICON_BTN, 'active:scale-90')}
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
                  className={cn(HEADER_ICON_BTN, 'disabled:opacity-40')}
                >
                  <Copy className="size-5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('forward')}
                  disabled={selectedIds.size === 0}
                  onClick={() => setForwardIds([...selectedIds])}
                  className={cn(HEADER_ICON_BTN, 'disabled:opacity-40')}
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
                  className={cn(
                    HEADER_ICON_BTN,
                    'text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40',
                  )}
                >
                  <Trash2 className="size-5" aria-hidden />
                </button>
              </header>
            )}
            {/* Режим поиска внутри чата (§3): ввод, счётчик совпадений, навигация ↑↓ и
                список найденных сообщений. Список — главное: без него единственным
                способом добраться до нужного совпадения было жать ↓ и смотреть, куда
                прыгнула переписка. Он лежит поверх ленты (absolute), чтобы прыжок к
                сообщению был виден за ним и переписка не сжималась, и открывается
                под самим полем ввода, а не во всю ширину шапки. */}
            {chatSearchOpen &&
              (() => {
                const found = chatSearchResults.data?.items ?? []
                const total = found.length
                return (
                  <div className="relative z-30 shrink-0">
                    <header className="flex items-center gap-1 border-b border-border px-2 py-3">
                      <button
                        type="button"
                        aria-label={t('cancel')}
                        onClick={closeChatSearch}
                        className={cn(HEADER_ICON_BTN, 'active:scale-90')}
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
                          // Кнопки «показать список» нет: выдача, закрытая выбором
                          // совпадения, снова открывается возвратом в поле.
                          onFocus={() => setSearchListOpen(true)}
                          onClick={() => setSearchListOpen(true)}
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
                          className="h-11 w-full rounded-xl border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20 lg:h-10"
                        />
                        {searchListOpen && chatSearchTerm.length >= 2 && total > 0 && (
                          <ul
                            aria-label={t('searchResults')}
                            className="absolute inset-x-0 top-full z-10 mt-1 max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover py-1 shadow-lg duration-150 animate-in fade-in slide-in-from-top-1"
                          >
                            {found.map((m, i) => (
                              <li key={m.id}>
                                <button
                                  type="button"
                                  onClick={() => pickSearchResult(i)}
                                  className={cn(
                                    'flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                                    i === searchIdx && 'bg-primary/10',
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                                        {m.senderId === myId ? t('you') : senderName(m)}
                                      </span>
                                      <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                                        {listTime(m.createdAt, locale)}
                                      </span>
                                    </div>
                                    {/* Совпавший кусок подсвечен: из строки в две строки видно,
                                      то ли это сообщение, ещё до перехода к нему. */}
                                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                      {highlightTerm(m.content || t('attachment'), chatSearchTerm)}
                                    </p>
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {/* Фильтр «От кого» (§4) — только в группах. */}
                      {activeIsGroup && (
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            aria-label={t('searchFrom')}
                            onClick={() => setSearchFromOpen((v) => !v)}
                            className={cn(
                              'flex h-11 max-w-28 items-center gap-1 rounded-xl px-2.5 text-xs transition-colors lg:h-10',
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
                        className={cn(HEADER_ICON_BTN, 'disabled:opacity-40')}
                      >
                        <ChevronUp className="size-5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t('searchNext')}
                        onClick={() => stepSearch(1)}
                        disabled={total === 0 || searchIdx >= total - 1}
                        className={cn(HEADER_ICON_BTN, 'disabled:opacity-40')}
                      >
                        <ChevronDown className="size-5" aria-hidden />
                      </button>
                    </header>
                  </div>
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
                className={cn(HEADER_ICON_BTN, 'md:hidden')}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              {/* Подсветка при наведении идёт вровень с шапкой: отрицательные поля
                  съедают её собственные отступы, поэтому область занимает всю высоту
                  и (на ПК, где кнопки «назад» нет) доходит до левого края. Скруглённый
                  прямоугольник в рамке из пустоты читался как чужой элемент внутри
                  шапки, а не как сама шапка. */}
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="-my-3 flex min-w-0 flex-1 items-center gap-2 rounded-none px-1 py-3 text-left transition-colors hover:bg-muted md:-ml-4 md:pl-4"
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
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm font-semibold">
                      {activeChat ? chatTitle(activeChat, t) : ''}
                    </span>
                    {activeChat && isOfficialChat(activeChat.type) && (
                      <BadgeCheck
                        className="size-3.5 shrink-0 text-info"
                        aria-label={t('officialChat')}
                      />
                    )}
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
                  className={HEADER_ICON_BTN}
                >
                  <Search className="size-5" aria-hidden />
                </button>
                {/* Переход по дате (#5): клик по числу сразу прокручивает историю к этому
                    дню и закрывает календарь — как в мессенджерах. Дата — действие, а не
                    значение формы, поэтому ни поля с текстом даты, ни «Готово» тут нет.
                    Будущее закрыто: сообщений там заведомо нет. */}
                <DateJumpPicker
                  className={HEADER_ICON_BTN}
                  value={jumpDate}
                  onChange={(ymd) => {
                    setJumpDate(ymd)
                    if (ymd) void jumpToDate(ymd)
                  }}
                  max={formatYmd(new Date())}
                  aria-label={t('jumpToDate')}
                  dayThumbs={dayThumbs}
                  onViewChange={(y, m) =>
                    setCalendarMonth(`${y}-${String(m + 1).padStart(2, '0')}`)
                  }
                  rangeAction={{
                    label: t('clearHistory'),
                    destructive: true,
                    onSubmit: (from, to) => {
                      void confirm({
                        title: t('clearPeriodConfirm', { from, to }),
                        destructive: true,
                      }).then((ok) => {
                        if (ok) clearPeriod.mutate({ from, to })
                      })
                    },
                  }}
                />
                {/* Действия — в меню «три точки». */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setHeaderMenuOpen((v) => !v)}
                    aria-label={t('messageActions')}
                    className={cn(
                      HEADER_ICON_BTN,
                      'relative',
                      headerMenuOpen && 'bg-muted text-foreground',
                    )}
                  >
                    <MoreVertical className="size-5" aria-hidden />
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
                        {/* «Выбрать» есть в меню сообщения, но включать режим оттуда можно
                            только зная, с какого сообщения начать; из шапки — над чатом целиком. */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectMode(true)
                            setSelectedIds(new Set())
                            setHeaderMenuOpen(false)
                          }}
                          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted"
                        >
                          <CheckCheck className="size-4 shrink-0 opacity-80" aria-hidden />
                          <span className="flex-1 text-left">{t('select')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setScheduledOpen(true)
                            setHeaderMenuOpen(false)
                          }}
                          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted"
                        >
                          <Clock className="size-4 shrink-0 opacity-80" aria-hidden />
                          <span className="flex-1 text-left">{t('scheduledTitle')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (activeChat)
                              archive.mutate({
                                chatId: activeChat.id,
                                archived: !activeChat.archived,
                              })
                            setHeaderMenuOpen(false)
                          }}
                          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted"
                        >
                          {activeChat?.archived ? (
                            <ArchiveRestore className="size-4 shrink-0 opacity-80" aria-hidden />
                          ) : (
                            <Archive className="size-4 shrink-0 opacity-80" aria-hidden />
                          )}
                          <span className="flex-1 text-left">
                            {activeChat?.archived ? t('unarchive') : t('archive')}
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
                        {/* «Разблокировать» не красный — остаётся среди обычных пунктов. */}
                        {activeChat?.blocked && headerBlockItem}
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
                        {/* Красные пункты — в самом конце, за линией. «Удалить чат» есть
                            всегда, когда есть чат, поэтому линия зависит только от него. */}
                        {activeChat && <MenuSeparator />}
                        {!activeChat?.blocked && headerBlockItem}
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

            {/* Закреплённое сообщение (§2 карты): подпись, первая строка текста и шкала
                закреплений слева. Крестик справа ПРЯЧЕТ полосу до следующего закрепления —
                это подсказка, а не само закрепление; снять его можно из меню полосы. */}
            {pinnedList.length > 0 &&
              !pinnedHidden &&
              (() => {
                const idx = pinnedIndex % pinnedList.length
                const cur = pinnedList[idx]
                if (!cur) return null
                return (
                  <div
                    className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const box = e.currentTarget.getBoundingClientRect()
                      const keyboard = e.clientX === 0 && e.clientY === 0
                      setPinnedMenu({
                        x: keyboard ? box.left + 24 : e.clientX,
                        y: keyboard ? box.bottom : e.clientY,
                      })
                    }}
                  >
                    {/* Клик по строке циклически переходит к следующему закреплённому (navigatePinned). */}
                    <button
                      type="button"
                      onClick={() => navigatePinned(pinnedList, 1)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {/* Шкала закреплений: по делению на каждое, текущее — сплошным акцентом.
                          Считать «2/7» глазами дольше, чем увидеть положение на шкале. Сверх
                          PINNED_SCALE_MAX делений полоска превращается в штриховку, и вместо
                          неё честнее показать число. */}
                      {pinnedList.length > 1 && pinnedList.length <= PINNED_SCALE_MAX ? (
                        <span className="flex h-7 w-0.5 shrink-0 flex-col gap-px" aria-hidden>
                          {pinnedList.map((p, i) => (
                            <span
                              key={p.id}
                              className={cn(
                                'flex-1 rounded-full',
                                i === idx ? 'bg-primary' : 'bg-primary/25',
                              )}
                            />
                          ))}
                        </span>
                      ) : (
                        <span className="h-7 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      )}
                      <Pin className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-[0.7rem] font-semibold text-primary">
                          {t('pinnedMessage')}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {cur.content || (cur.media.length ? t('attachment') : '')}
                        </span>
                      </span>
                      {pinnedList.length > PINNED_SCALE_MAX && (
                        <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                          {idx + 1}/{pinnedList.length}
                        </span>
                      )}
                    </button>
                    {pinnedList.length > 1 && (
                      <button
                        type="button"
                        aria-label={t('pinnedMessages')}
                        title={t('pinnedMessages')}
                        onClick={() => setPinnedListOpen(true)}
                        className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ListIcon className="size-3.5" aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t('pinnedHide')}
                      title={t('pinnedHide')}
                      onClick={() => setPinnedHiddenKey(pinnedKey)}
                      className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden />
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
              {/* Прилипшая дата: видна, только когда пометка дня уехала под верх ленты. */}
              {floatingDay && !loadingOlder && (
                <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                  <span
                    className={cn(
                      'rounded-full bg-muted/90 px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-opacity duration-200',
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
                // Плавающий композер перекрывает низ ленты — держим под ним пустоту ровно
                // по его высоте, иначе последнее сообщение уезжает под панель.
                style={{ paddingBottom: composerH + 8 }}
              >
                {messages.isLoading ? (
                  <div className="flex flex-col gap-3">
                    {MESSAGE_SKELETONS.map((bubble, i) => (
                      <div
                        key={i}
                        className={cn('flex', bubble.mine ? 'justify-end' : 'justify-start')}
                        aria-hidden
                      >
                        <Skeleton className={cn('rounded-2xl', bubble.size)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Virtualizer ref={virtualizerRef} scrollRef={messagesScrollRef} shift={shiftMode}>
                    {(messages.data ?? []).map((m, i) => {
                      const mine = m.senderId === myId
                      // Группировка подряд идущих сообщений одного автора: аватар/имя — только у первого в серии.
                      const arr = messages.data ?? []
                      const prevMsg = arr[i - 1]
                      const firstOfRun = prevMsg?.senderId !== m.senderId
                      // Пометка дня: перед первым сообщением и при смене календарного дня.
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
                          showDay={showDay}
                          dayText={showDay ? dayLabel(m.createdAt) : null}
                          isFirstInList={i === 0}
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
                  className="absolute right-3 z-20 flex size-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-transform duration-200 animate-in fade-in zoom-in-90 hover:bg-muted active:scale-95"
                  style={{ bottom: composerH + 12 }}
                >
                  <ChevronDown className="size-5" aria-hidden />
                  {newSinceScroll > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-bold text-primary-foreground">
                      {newSinceScroll > 99 ? '99+' : newSinceScroll}
                    </span>
                  )}
                </button>
              )}
              {/* Панель ввода. На телефоне — плавающий остров поверх ленты (Telegram-стиль):
                он не прибит к краю, лента прокручивается под ним, а место под последним
                сообщением держит padding по измеренной высоте панели.
                На ПК панель докована: сплошная плашка во всю ширину с верхней границей —
                та же поверхность, что у шапки чата. Парящие острова оставляли между собой
                и по краям просветы, сквозь которые лезла лента: у большого пальца это
                читается как «панель лежит поверх», у курсора — как дырки в интерфейсе. */}
              {!activeChat?.requestIncoming && (
                <div
                  ref={setComposerBox}
                  // Зазор снизу — safe-area, но только пока нет клавиатуры: с поднятой клавиатурой
                  // (--kb-inset) полоса жеста уже закрыта, и запас превратился бы в пустую щель.
                  className={cn(
                    'absolute inset-x-0 bottom-0 z-30',
                    'pointer-events-none px-3 pb-[max(0.5rem,calc(0.5rem+env(safe-area-inset-bottom)-var(--kb-inset,0px)))]',
                    // Плашка ловит указатель сама: прокручивать ленту «сквозь» непрозрачную
                    // поверхность всё равно негде. py-2 вокруг 44-px ряда — та же высота, что
                    // у плашки профиля внизу сайдбара: их верхние границы идут одной линией.
                    'lg:pointer-events-auto lg:border-t lg:border-border lg:bg-background lg:py-2',
                  )}
                >
                  <ChatComposer
                    editing={editing}
                    onCancelEdit={() => {
                      setEditing(null)
                      setText('')
                    }}
                    replyTo={replyTo}
                    replyToName={replyTo ? senderName(replyTo) : ''}
                    replyQuote={replyQuote}
                    onCancelReply={() => {
                      setReplyTo(null)
                      setReplyQuote(null)
                    }}
                    onViewReplyTarget={() => {
                      if (replyTo) focusMessage(replyTo.id)
                    }}
                    silent={silentSend}
                    onToggleSilent={() => setSilentSend((v) => !v)}
                    onScheduleSend={() => setScheduleOpen(true)}
                    blocked={!!blockedActive}
                    iBlocked={!!activeChat?.blocked}
                    requestPending={requestWaiting}
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
            </div>
            {/* «печатает…» показываем в шапке (вместо статуса), а не здесь — Telegram-стиль. */}

            {/* §50: непринятый входящий запрос — вместо поля ввода решение адресата.
                Инициатору вместо этого показываем, что его сообщение ещё не принято. */}
            {activeChat?.requestIncoming && (
              <div className="flex flex-col gap-3 border-t border-border p-4">
                <p className="text-center text-sm text-muted-foreground">{t('requestPrompt')}</p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    loading={acceptRequest.isPending}
                    onClick={() => acceptRequest.mutate(activeChat.id)}
                  >
                    {t('requestAccept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={declineRequest.isPending}
                    onClick={() => {
                      void confirm({ title: t('requestDeclineConfirm'), destructive: true }).then(
                        (ok) => {
                          if (ok) declineRequest.mutate(activeChat.id)
                        },
                      )
                    }}
                  >
                    {t('requestDecline')}
                  </Button>
                </div>
              </div>
            )}
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
              <ChatDetailsPanel
                key={detailsProps.chat.id}
                {...detailsProps}
                variant="column"
                open={detailsOpen}
              />
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
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          actions={{
            onReact: (emoji) => react.mutate({ messageId: menu.message.id, emoji }),
            onReply: () => startReply(menu.message, menu.selection),
            onEdit: () => startEdit(menu.message),
            // Закрепление видят все участники чата, поэтому спрашиваем в обе стороны (§4 карты):
            // «закрепить» — обычное подтверждение, «открепить» — красное.
            onPin: () => {
              const pinned = !!menu.message.pinnedAt
              const id = menu.message.id
              void confirm({
                title: pinned ? t('unpinConfirm') : t('pinConfirm'),
                confirmLabel: pinned ? t('unpin') : t('pin'),
                destructive: pinned,
              }).then((ok) => {
                if (ok) setPin.mutate({ id, pinned: !pinned })
              })
            },
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
          tabs={forwardTabs}
          onResolveSaved={resolveSavedChatId}
          onSubmit={(targetChatIds, caption) =>
            sendForward(targetChatIds, [forwardMsg.id], caption)
          }
          onClose={() => setForwardMsg(null)}
        />
      )}

      {/* Пересылка нескольких выбранных сообщений (мультивыбор): по одному forward на каждое. */}
      {forwardIds && (
        <ForwardDialog
          chats={list}
          currentChatId={activeId}
          titleOf={(c) => chatTitle(c, t)}
          tabs={forwardTabs}
          onResolveSaved={resolveSavedChatId}
          onSubmit={(targetChatIds, caption) => sendForward(targetChatIds, forwardIds, caption)}
          onClose={() => {
            setForwardIds(null)
            exitSelect()
          }}
        />
      )}

      {scheduleOpen && activeId && (
        <ScheduleSendDialog
          preview={text.trim()}
          pending={schedule.isPending}
          onClose={() => setScheduleOpen(false)}
          onConfirm={(scheduledAt) => schedule.mutate({ chatId: activeId, scheduledAt })}
        />
      )}

      {scheduledOpen && activeId && (
        <ScheduledPanel chatId={activeId} onClose={() => setScheduledOpen(false)} />
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

      {/* Меню полосы закреплённого (§2 карты): список всех закреплений и снятие текущего. */}
      {pinnedMenu &&
        (() => {
          const cur = pinnedList[pinnedIndex % pinnedList.length]
          if (!cur) return null
          return (
            <RowContextMenu
              x={pinnedMenu.x}
              y={pinnedMenu.y}
              ariaLabel={t('pinnedMessage')}
              onClose={() => setPinnedMenu(null)}
              items={[
                {
                  key: 'pinned-all',
                  icon: ListIcon,
                  label: t('pinnedMessages'),
                  onClick: () => setPinnedListOpen(true),
                },
                {
                  key: 'unpin',
                  icon: PinOff,
                  label: t('unpin'),
                  // Закрепление в чате общее: снимая его, человек меняет шапку всем
                  // участникам — отсюда подтверждение, а не молчаливое действие.
                  onClick: () => {
                    void confirm({ title: t('unpinConfirm'), destructive: true }).then((ok) => {
                      if (ok) setPin.mutate({ id: cur.id, pinned: false })
                    })
                  },
                  danger: true,
                },
              ]}
            />
          )
        })()}

      {/* Все закрепления чата отдельным списком — из полосы или из её меню. */}
      {pinnedListOpen && (
        <Modal
          onClose={() => setPinnedListOpen(false)}
          title={t('pinnedMessages')}
          size="md"
          bodyClassName="p-0"
        >
          <div className="flex max-h-[min(70vh,32rem)] flex-col overflow-y-auto p-2">
            {pinnedList.map((m, i) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <button
                  type="button"
                  onClick={() => {
                    setPinnedIndex(i)
                    setPinnedTouched(true)
                    setPinnedListOpen(false)
                    focusMessage(m.id)
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span className="text-xs font-semibold text-primary">{senderName(m)}</span>
                  <span className="line-clamp-2 text-sm text-foreground/90">
                    {m.content || (m.media.length ? t('attachment') : '')}
                  </span>
                  <span className="mt-0.5 text-[0.7rem] text-muted-foreground">
                    {new Date(m.createdAt).toLocaleString(locale, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('unpin')}
                  title={t('unpin')}
                  onClick={() => {
                    void confirm({ title: t('unpinConfirm'), destructive: true }).then((ok) => {
                      if (ok) setPin.mutate({ id: m.id, pinned: false })
                    })
                  }}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <PinOff className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      <ChatFoldersDialog
        open={foldersOpen}
        onOpenChange={setFoldersOpen}
        folders={folderList}
        chats={chats.data ?? []}
        busy={createFolder.isPending || updateFolder.isPending || deleteFolder.isPending}
        editId={foldersEditId}
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

      {blockedOpen && <BlockedUsersDialog onClose={() => setBlockedOpen(false)} />}

      {attachOpen && (
        <AttachmentDialog
          files={attachFiles}
          sending={false}
          onSend={(caption, options) => sendAttachments(caption, options)}
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
