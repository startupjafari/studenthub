'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  CHAT_FOLDER_LIMITS,
  canFileComplaint,
  type ChatAction,
  type CreateChatPollInput,
} from '@studenthub/shared-schemas'
import { directoryKeys, fetchUserDirectory } from '../../../entities/user'
import { useAppSelector } from '../../../shared/store'
import { ReportModal } from '../../../features/report-content'
import { useRealtimeSocket, useRealtimeEvent, SELF_RESYNC_META } from '../../../shared/realtime'
import {
  chatKeys,
  exportChatFile,
  fetchChats,
  fetchChatsHead,
  fetchSavedChat,
  createChatPoll,
  fetchMessages,
  fetchPinned,
  fetchPresence,
  fetchChatMembers,
  fetchReadReceipts,
  saveChatDraft,
  forwardBatchRequest,
  pinMessageRequest,
  searchMessages,
  sendMessageWithAttachments,
  sendMessageWithDirectUpload,
  setChatMutedRequest,
  setChatPinnedRequest,
  setChatArchivedRequest,
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
  useDefaultReaction,
  useChatSettingsSync,
  AttachmentDialog,
  ALBUM_MAX_ITEMS,
  compressImages,
  convertUnsupportedImages,
  ForwardDialog,
  MessageContextMenu,
  fetchChatUpdates,
  fetchChatFolders,
  createChatFolderRequest,
  updateChatFolderRequest,
  deleteChatFolderRequest,
  useVoiceRecorder,
  useRoundVideoRecorder,
  useMessageViews,
  createRefreshCoalescer,
  scheduleChatsUnreadRefresh,
  applyLocationUpdate,
  type ChatFolder,
  type ChatListItem,
  type SavedChatDraft,
  type ChatMemberInfo,
  type ChatMessage,
  type ChatReadReceipt,
  type AttachmentSendOptions,
  type MessageAttachment,
  type MessageChecklist,
  type MessageLocation,
  type MessageMenuAnchor,
} from '../../../entities/chat'
import { needsDirectUpload } from '../../../shared/api'
import {
  OPEN_PAGE,
  firstUnreadPosition,
  needsWindow,
  openAnchor,
  unreadAfter,
  withReceipt,
} from '../lib/read-tracking'
import { latestSeqOf, mergeUpdates } from '../lib/merge-updates'
import {
  mergeChatHead,
  withDraft,
  withEditedMessage,
  withNewMessage,
  withOthersRead,
  withOwnRead,
} from '../lib/list-refresh'
import {
  applyAction,
  summarizeActors,
  sweepActions,
  uploadActionOf,
  UPLOAD_ACTION_DELAY_MS,
  type ActionsByChat,
} from '../lib/chat-actions'
import { useChatActionSender, useEndChatActionOnUnmount } from '../lib/use-chat-action'
import { useChatActionLabel } from '../lib/use-chat-action-label'
import {
  createPresenceStore,
  othersOnlineCount,
  peerIdOf,
  usePresence,
} from '../lib/presence-store'
import { useChatHeaderSearch } from '../lib/use-chat-header-search'
import { ChatDetailsPanel } from './chat-details-panel'
import { RightColumn } from './right-column'
import { ChatFoldersPanel } from './chat-folders-panel'
import { MessageItem, type MessageActions, type MessageReadState } from './message-item'
import { messageRunPosition } from '../lib/message-run'
import { ChatComposer, type ComposerSendOptions } from './chat-composer'
import { forwardRequestId, useForwardDraft } from '../lib/use-forward-draft'
import { AudioPlayerBar } from './audio-player-bar'
import { PollCreator } from './poll-creator'
import { ComposerDropArea, dropModeOf } from './composer-drop-area'
import { lastEditableMessage } from '../lib/composer-last-editable'
import { BlockedUsersPanel } from './blocked-users-panel'
import { CreateGroupPanel } from './create-group-panel'
import { ChatHeader } from './chat-header'
import { ChatHeaderMenu } from './chat-header-menu'
import { ChatHeaderPinned } from './chat-header-pinned'
import { ChatHeaderSearch, ChatHeaderSearchFooter } from './chat-header-search'
import { ChatHeaderSelection } from './chat-header-selection'
import { ChatHeaderStatus } from './chat-header-status'
import {
  Button,
  DateJumpPicker,
  formatYmd,
  useConfirm,
  type RichTextHandle,
} from '../../../shared/ui'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import { cn } from '../../../shared/lib/utils'
import {
  afterScrollSettles,
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

import { ChatCalendarModal } from './chat-calendar-modal'
import {
  BackCloseWhileOpen,
  ScreenStack,
  useScreenStack,
  type ScreenStackHandle,
} from '../../../shared/ui'
import { ConversationList } from './conversation-list'
import { ChatWallpaper } from './chat-wallpaper'
import { ConnectionStatusLine, ConnectionStatusTitle } from './connection-status'
import { ChatSelectionFooter } from './chat-selection-bar'
import { useConnectionStatus } from '../lib/use-connection-status'
import { ChatListRail, ChatListResizeHandle } from './chat-list-rail'
import { useChatListWidth } from '../lib/use-list-width'
import { chatTitle, senderName } from '../lib/format'
import { buildFolderTabs, filterChatsByTab, folderTabLabel } from '../lib/folders'
// Лента сообщений в духе Telegram: плавающие кнопки, жесты, въезд новых, реакции.
import { useMessageListAttention } from '../lib/use-message-list-attention'
import { useMessageListGestures } from '../lib/use-message-list-gestures'
import { useListScrolling, useNewMessageAppear } from '../lib/use-message-list-motion'
import { MessageListFab } from './message-list-fab'
import { MessageListSwipeHint, type SwipeReplyHintHandle } from './message-list-swipe-hint'
import { ReactionsListModal } from './reactions-list-modal'
import { flyReaction, type FlightPoint } from '../lib/reaction-flight'
import { useIncomingReactionPop } from '../lib/use-incoming-reaction-pop'
import { QuickReactionPanel } from './quick-reaction-panel'

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
  /** Кружок: единственное вложение — видеосообщение с камеры. */
  videoNote?: boolean
}

/** Чат-события, об отказе в которых человеку нужно сказать. Прочтение, «печатает» и вход в
 * комнату не в счёт: их отказ ему нечем показать, тост был бы шумом. */
const WS_ERROR_EVENTS = new Set(['message:send', 'message:edit', 'message:delete'])
/** Коды, для которых есть текст в словаре `Errors`; прочие показываются общей ошибкой. */
const WS_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'FORBIDDEN',
  'WRONG_SCOPE',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMIT',
  'MAINTENANCE',
  'UNIVERSITY_BLOCKED',
  'INTERNAL_ERROR',
])

/**
 * Запас границы догона на неизмеренное расхождение часов. Лишняя правка в дельте ничего не
 * стоит — она просто применится ещё раз, — а потерянная висит у человека до перезагрузки.
 */
const SYNC_SKEW_MARGIN_MS = 2 * 60 * 1000

/** «Сейчас» по часам сервера (своё время плюс измеренное расхождение) минус запас. */
function serverNowIso(skewMs: number): string {
  return new Date(Date.now() + skewMs - SYNC_SKEW_MARGIN_MS).toISOString()
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

// Высота пометки дня в потоке ленты: строка 20 px + вертикальные отступы my-2 (8+8).
// По ней понимаем, ушла ли пометка под верх — тогда её подменяет прилипший заголовок.
const DAY_LABEL_H = 36
/** Как часто уходит отметка о прочтении при прокрутке: последним дочитанным сообщением. */
const READ_EMIT_MS = 800

// Обновление списка чатов по событиям (F-F02). Событие в другом чате — почти сразу, но
// пачка событий (сообщение + `chat:activity` + уведомление, альбом, поток в группе) — одним
// запросом. В читаемом чате ждём, пока уйдёт отметка о прочтении (READ_EMIT_MS), — иначе
// счётчик мигал бы; поток событий не откладывает обновление дольше потолка.
const LIST_REFRESH_MS = 300
const LIST_REFRESH_READING_MS = 1500
const LIST_REFRESH_MAX_WAIT_MS = 5000
const LIST_REFRESH_MIN_INTERVAL_MS = 1000

// Скелетон ленты сообщений: форма будущих пузырей (FRONTEND_RULES §13 — загрузка показывается
// скелетоном, а не спиннером), чередование «чужой/свой» и разная ширина.
// Иконочные кнопки шапок чата (обычная, поиск, выбор сообщений) — одна геометрия на все три
// режима: 44 px под палец (§13) и 40 px под курсор, иконка внутри size-5. Раньше в одном ряду
// стояли кнопки 32 и 36 px, и шапка читалась как собранная из разных наборов.
const HEADER_ICON_BTN =
  'flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:size-10'

export function ChatWindow() {
  const t = useTranslations('Chats')
  const actionLabelOf = useChatActionLabel()
  const tErr = useTranslations('Errors')
  const unitLabel = useByteUnitLabel()
  const tRoles = useTranslations('Roles')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()
  const socket = useRealtimeSocket()
  // Отправка «я сейчас это делаю». Сокет читаем через ref внутри хука, поэтому пересоздания
  // соединения не роняют уже идущее действие.
  const chatActions = useChatActionSender((chatId, action) => {
    socket?.emit('chat:action', { chatId, action })
  })
  useEndChatActionOnUnmount(chatActions)
  // Для эффектов, которым нужен только «стоп»: сам отправитель стабилен, но линтеру об этом
  // не известно, а тащить его в зависимости эффекта по смене чата нельзя — эффект должен
  // срабатывать ровно на смену чата.
  const chatActionsRef = useRef(chatActions)
  chatActionsRef.current = chatActions
  const me = useAppSelector((s) => s.auth.user)
  const myId = me?.id
  // «Пожаловаться» — тем, чью жалобу сервер примет (COMPLAINT_REPORTER_ROLES): травля в
  // личке иначе не доходила до модерации ни из одного клиента.
  const canReport = canFileComplaint(useAppSelector((s) => s.auth.role))
  const confirm = useConfirm()
  // #1: состояние оптимистичных сообщений по temp-id (`tmp:<nonce>`) + таймеры «не пришло эхо».
  const [sendState, setSendState] = useState<Record<string, 'pending' | 'failed'>>({})
  const sendTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // nonce сообщений, отправленных «без превью ссылки» (плашку закрыли): для повтора отправки.
  const noPreviewNonces = useRef<Set<string>>(new Set())

  // Десктоп: список чатов порталим в слот сайдбара (см. AppSidebar chatsMode).
  // На мобильном слота нет — список остаётся во весь экран внутри main.
  const listSlot = useChatListSlot()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // Достаточно широкий экран (≥xl) — правая панель деталей докается третьей колонкой,
  // не закрывая переписку (Telegram-стиль §1). На узких экранах — прежнее модальное окно.
  const isWide = useMediaQuery('(min-width: 1280px)')
  // Телефон (Telegram: isMobile). Поиск по чату на нём уводит счётчик и стрелки в нижнюю
  // панель вместо поля ввода, а пункт «Поиск» живёт в меню шапки.
  const isPhone = useMediaQuery('(max-width: 767px)')
  const embedded = isDesktop && !!listSlot
  // Открытый чат — полноэкранная поверхность на мобильном: просим оболочку скрыть нижнюю навигацию,
  // иначе фиксированная панель перекрывает поле ввода сообщения.
  const setChatOpen = useSetChatOpen()

  const [newChatOpen, setNewChatOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  // Экран «Быстрая реакция» в колонке чатов (настройки чатов, как в Telegram).
  const [quickReactionOpen, setQuickReactionOpen] = useState(false)
  // Своя быстрая реакция (`GET /chats/settings`): двойной клик, кнопка у пузыря, первая в меню.
  const quickReaction = useDefaultReaction()
  useChatSettingsSync()
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Открытие конкретного чата извне через ?chat=<id> (например кнопка «Написать» из профиля).
  const searchParams = useSearchParams()
  // id из адреса подставляются в пути API (`/chats/${id}/messages`): `../` в параметре
  // вёл бы запрос на другой эндпоинт. Чужой формат просто игнорируем.
  const requestedChatId = safeParamId(searchParams.get('chat'))
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
  const deepChatId = safeParamId(searchParams.get('c'))
  const deepMsgId = safeParamId(searchParams.get('m'))
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
  // Кто что делает в чатах прямо сейчас (§9.1). Состояние эфемерное — только в памяти вкладки.
  const [actionsByChat, setActionsByChat] = useState<ActionsByChat>({})
  const [connected, setConnected] = useState(true)
  // Момент, до которого мы точно получали события, — граница для правок и удалений при догоне.
  // Сервер сравнивает её со своими часами, поэтому она в серверном времени (§9.2c): после
  // догона — `syncedAt` из ответа, при обрыве — свои часы с поправкой на расхождение,
  // измеренное по тому же ответу, и с запасом на случай, когда его ещё не мерили.
  // Начальное значение покрывает connect без предшествующего disconnect (перехват лидерства
  // мастер-вкладки).
  const clockSkewMs = useRef(0)
  const lastSyncAt = useRef(serverNowIso(0))
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined)
  const [canLoadOlder, setCanLoadOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Курсор более НОВЫХ сообщений: не-undefined только после jump в «прыгнутое» окно (around),
  // когда снизу есть неподгруженные сообщения (Этап 1, двунаправленная пагинация).
  const [newerCursor, setNewerCursor] = useState<string | undefined>(undefined)
  const [canLoadNewer, setCanLoadNewer] = useState(false)
  // Живое сообщение пришло, пока окно было «прыгнутым», и в кэш не легло (см. message:new).
  const skippedLiveRef = useRef(false)
  const loadingNewerRef = useRef(false)
  // Курсоры истории живут ПО ЧАТУ. Кэш сообщений у каждого чата свой и переживает
  // переключение, а курсоры были одни на окно: A → B → A — и A догружал старые по курсору B,
  // сервер не находил его в чате A, отвечал пустой страницей с hasNext=false, и история A
  // дальше не листалась. Окно вокруг найденного сообщения тоже возвращалось как «низ».
  type Pager = { older?: string; canOlder: boolean; newer?: string; canNewer: boolean }
  const pagerByChatRef = useRef(new Map<string, Pager>())
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  function setPager(chatId: string, patch: Partial<Pager>): void {
    const next: Pager = {
      canOlder: false,
      canNewer: false,
      ...pagerByChatRef.current.get(chatId),
      ...patch,
    }
    pagerByChatRef.current.set(chatId, next)
    if (chatId !== activeIdRef.current) return
    setOlderCursor(next.older)
    setCanLoadOlder(next.canOlder)
    setNewerCursor(next.newer)
    setCanLoadNewer(next.canNewer)
  }
  // Ф9+: ответ, вложения, поиск.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  // Процитированный фрагмент отвечаемого сообщения: заполняется, если в момент нажатия
  // «Ответить» внутри этого сообщения был выделен текст (Telegram-стиль).
  const [replyQuote, setReplyQuote] = useState<string | null>(null)
  // «Без звука» — залипающий переключатель у кнопки отправки, сбрасывается при смене чата.
  // Диалог «отправить позже» и панель уже отложенных сообщений этого чата.
  // Прикрепление файлов через диалог «Отправить как файл» (Telegram-стиль).
  const [attachFiles, setAttachFiles] = useState<File[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  // Файлы брошены в зону «без сжатия» — окно отправки открывается сразу в этом режиме.
  const [attachAsFiles, setAttachAsFiles] = useState(false)
  // Перетаскивание файлов в переписку: подсветка зоны и счётчик вложенных dragenter/dragleave.
  const [dropActive, setDropActive] = useState(false)
  const dragDepth = useRef(0)
  // Создание опроса (§38) — диалог из attachment-меню композера.
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false)
  // Единый поиск в панели чатов: по названиям чатов + по сообщениям (глобально).
  const [listSearchRaw, setListSearchRaw] = useState('')
  const [listSearchTerm, setListSearchTerm] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Сообщение, к которому сейчас едем (ссылка, ответ, поиск, дата). Пока оно задано, начальная
  // прокрутка открытого чата («к непрочитанным / вниз») и удержание низа не вмешиваются —
  // иначе вторым проходом они уводили ленту от цели, и ссылка на сообщение открывала низ чата.
  const focusTargetRef = useRef<string | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  // Время, до которого другие участники прочитали чат — для статусов ✓/✓✓ своих сообщений.
  const [readWatermark, setReadWatermark] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null)
  const [reportMsg, setReportMsg] = useState<ChatMessage | null>(null)
  // Присутствие участников открытого чата — вне состояния окна: событие о человеке не
  // перерисовывает ленту, а о постороннем для чата — вообще ничего (F-F12).
  const [presenceStore] = useState(createPresenceStore)
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
  // Отправленная правка до подтверждения: при отказе сервера текст возвращается в поле ввода.
  const pendingEditRef = useRef<{ message: ChatMessage; content: string } | null>(null)
  // Дата перехода по истории: хранится, чтобы поле показывало выбранное значение, а не
  // возвращалось к плейсхолдеру — иначе непонятно, к какому дню прокручен чат.
  const [jumpDate, setJumpDate] = useState('')
  // День, на пилюлю которого нажали: открыт календарь переписки (Telegram-стиль).
  const [calendarDay, setCalendarDay] = useState<string | null>(null)
  // Докнутая правая панель деталей (десктоп ≥xl): профиль/участники/медиа без ухода из чата.
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Кнопка «вниз» + счётчик сообщений, пришедших пока пользователь пролистан вверх (Telegram-стиль).
  const [showScrollDown, setShowScrollDown] = useState(false)
  // Прочитано до этого момента в открытом чате (время сообщения). Растёт по мере того, как
  // сообщения появляются на экране, — от него считается «непрочитанных ниже» на кнопке «вниз».
  const [readUpTo, setReadUpTo] = useState<string | null>(null)
  const readUpToRef = useRef<string | null>(null)
  // Отметка о прочтении уходит на сервер не на каждый кадр прокрутки, а раз в READ_EMIT_MS —
  // последним дочитанным сообщением.
  const pendingReadRef = useRef<{ chatId: string; id: string } | null>(null)
  const readTimerRef = useRef<number | null>(null)
  // Плавающий заголовок даты (Telegram-стиль §6): дата верхнего видимого сообщения, гаснет вне скролла.
  const [floatingDay, setFloatingDay] = useState<string | null>(null)
  // Дата прилипшей пилюли — для календаря по нажатию на неё.
  const [floatingDayAt, setFloatingDayAt] = useState<string | null>(null)
  const [floatingDayShown, setFloatingDayShown] = useState(false)
  // Режим множественного выбора сообщений (Telegram-стиль): чекбоксы + массовые действия.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Пересылка нескольких выбранных сообщений (id) — переиспользуем ForwardDialog.
  const [forwardIds, setForwardIds] = useState<string[] | null>(null)
  // Пересылка по модели Telegram (П.32): выбор чата открывает его, а сообщения ждут над
  // полем ввода до «Отправить». «Сменить получателя» снова открывает выбор чата.
  const forward = useForwardDraft({
    activeId,
    replyToId: replyTo?.id,
    editingId: editing?.id,
    onError: (code) => toast.error(tErr(code)),
  })
  const [forwardRepick, setForwardRepick] = useState(false)
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

  // Разделитель «Непрочитанные»: снимок кол-ва непрочитанных при открытии + id первого непрочитанного.
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
  // Кадр и таймер доводки первичного скролла — гасятся при смене чата.
  const openRafRef = useRef<number | null>(null)
  const openTimeoutRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<RichTextHandle>(null)
  // Автодополнение @-упоминаний: активный запрос после @ (null — попап скрыт).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)

  // Когда начался последний полный перезапрос списка: точечное обновление первой страницей
  // не должно затирать более свежий полный ответ (см. refreshListHead).
  const fullListFetchAtRef = useRef(0)
  const chats = useQuery({
    queryKey: chatKeys.list(),
    queryFn: () => {
      fullListFetchAtRef.current = Date.now()
      return fetchChats()
    },
  })
  // Держим свежий список в ref — чтобы снять снимок непрочитанных РОВНО при открытии чата (до инвалидации).
  chatsRef.current = chats.data

  const messages = useQuery({
    queryKey: chatKeys.messages(activeId ?? ''),
    // После реконнекта лента догоняется по seq (catchUp ниже), а не перезапросом первой
    // страницы: тот сбрасывал подгруженную вверх историю и позицию чтения (F-F13). То же
    // делал и собственный рефетч React Query на возврат сети — он тоже выключен.
    meta: SELF_RESYNC_META,
    refetchOnReconnect: false,
    queryFn: async () => {
      const chatId = activeId as string
      // Первое открытие чата с непрочитанным, до которого больше страницы, — сразу окно вокруг
      // первого непрочитанного (Telegram), а не низ истории с плашкой на самом раннем из
      // загруженного. Повторные загрузки (кнопка «вниз», перезапрос) — как раньше, у низа.
      const listItem = chatsRef.current?.find((c) => c.id === chatId)
      const opening = !pagerByChatRef.current.has(chatId)
      const anchor = opening ? openAnchor(listItem, OPEN_PAGE) : { kind: 'bottom' as const }
      const atAnchor =
        anchor.kind === 'around'
          ? await fetchMessages(chatId, { limit: OPEN_PAGE, around: anchor.messageId })
          : null
      const page = atAnchor ?? (await fetchMessages(chatId, { limit: OPEN_PAGE }))
      // Непрочитанных меньше страницы, но первое из них в неё не попало (между ними много
      // своих сообщений) — тоже окно вокруг него.
      const around =
        atAnchor ??
        (opening && needsWindow(page, listItem?.firstUnreadId)
          ? await fetchMessages(chatId, { limit: OPEN_PAGE, around: listItem?.firstUnreadId ?? '' })
          : null)
      if (around) {
        setPager(chatId, {
          older: around.cursor,
          canOlder: around.hasNext,
          newer: around.prevCursor,
          canNewer: around.hasPrev,
        })
        return [...around.items].reverse()
      }
      // Первичная загрузка — у низа истории: более новых нет.
      setPager(chatId, {
        older: page.cursor,
        canOlder: page.hasNext,
        newer: undefined,
        canNewer: false,
      })
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
      // Цель — сразу, ещё до загрузки истории: эффект начальной прокрутки увидит её и не
      // поедет к непрочитанным или вниз.
      focusTargetRef.current = deepMsgId
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
   * Поставить или снять реакцию. Постановка с известной точкой нажатия (`origin`) — с полётом
   * эмодзи к своему чипу (lib/reaction-flight); снятие не летит.
   */
  const reactTo = (messageId: string, emoji: string, origin?: FlightPoint): void => {
    const cached = activeId
      ? qc.getQueryData<ChatMessage[]>(chatKeys.messages(activeId))?.find((m) => m.id === messageId)
      : undefined
    const adding = !cached?.reactions.some((r) => r.userId === myId && r.emoji === emoji)
    react.mutate({ messageId, emoji })
    if (adding && origin) flyReaction({ messageId, emoji, from: origin })
  }

  /**
   * Пересылка сразу, без плашки над полем: несколько получателей из окна выбора (режим
   * «выбрать несколько») и «Избранное». Одним запросом пачкой: подпись уходит перед
   * пересланным, как в Telegram, а повтор после обрыва связи не задублирует сообщения.
   */
  async function sendForward(
    targetChatIds: string[],
    messageIds: string[],
    caption: string,
  ): Promise<void> {
    try {
      const results = await forwardBatchRequest({
        messageIds,
        chatIds: targetChatIds,
        ...(caption ? { comment: caption } : {}),
        requestId: forwardRequestId(),
      })
      const failed = results.find((r) => !r.ok)
      if (failed) {
        toast.error(tErr(failed.code ?? 'INTERNAL_ERROR'))
        return
      }
      setForwardMsg(null)
      toast.success(t('forwarded'))
    } catch (e) {
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    }
  }

  /**
   * Выбор одного чата в окне пересылки — модель Telegram: чат открывается, сообщения
   * встают плашкой над полем ввода и уходят по «Отправить» вместе с дописанным текстом.
   * «Избранное» — исключение, как и там: туда пересылают «на память» и сразу.
   */
  function pickForwardTarget(
    targetChatId: string,
    picked: ChatMessage[],
    // «Сменить получателя»: та же пересылка с теми же «скрыть имя/подписи» — в другой чат.
    opts: { retarget?: boolean } = {},
  ): void {
    const target = list.find((c) => c.id === targetChatId)
    // Чата нет в списке — это только что заведённое «Избранное» (onResolveSaved).
    if (!target || target.type === 'SAVED') {
      void sendForward(
        [targetChatId],
        picked.map((m) => m.id),
        '',
      )
      return
    }
    if (opts.retarget) forward.retarget(targetChatId)
    else forward.start(targetChatId, picked)
    setReplyTo(null)
    setReplyQuote(null)
    setEditing(null)
    setActiveId(targetChatId)
    requestAnimationFrame(() => composerRef.current?.focus())
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

  /**
   * Новый порядок вкладок после перетаскивания папки.
   *
   * Отдельной ручки «переставить всё» у API нет — уезжает по PATCH на каждую сдвинувшуюся
   * папку. Кэш переписываем сразу: порядок правят перетаскиванием, и вернуться на секунду
   * к старому читалось бы как «не получилось».
   */
  const reorderFolders = (ids: string[]): void => {
    const byId = new Map(folderList.map((f) => [f.id, f]))
    const next = ids.flatMap((id, position) => {
      const f = byId.get(id)
      return f ? [{ ...f, position }] : []
    })
    const previous = folderList
    qc.setQueryData<ChatFolder[]>(chatKeys.folders(), next)
    const moved = next.filter((f) => byId.get(f.id)?.position !== f.position)
    void Promise.all(moved.map((f) => updateChatFolderRequest(f.id, { position: f.position })))
      .catch((e) => {
        qc.setQueryData<ChatFolder[]>(chatKeys.folders(), previous)
        folderError(e)
      })
      .finally(invalidateFolders)
  }

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
    // Заглушённые чаты в бейдж навигации не идут (F-F14) — он меняется вместе с флагом.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
    },
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

  // Очищенное «у себя» непрочитанным больше не считается — бейдж тоже обновляем.
  const clearChat = useMutation({
    mutationFn: (chatId: string) => clearChatRequest(chatId),
    onSuccess: (_d, chatId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
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
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
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
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
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
  // Смена чата или свежий снимок — карта заменяется целиком: участники другого чата в ней
  // не задерживаются.
  useEffect(() => {
    presenceStore.reset(presenceQuery.data)
  }, [activeId, presenceQuery.data, presenceStore])

  // Инициализация watermark прочтения при смене активного чата (из списка чатов).
  useEffect(() => {
    const chat = chats.data?.find((c) => c.id === activeId)
    setReadWatermark(chat?.othersReadAt ?? null)
  }, [activeId, chats.data])

  // Запись голосового: по завершению отправляем сразу как вложение (Telegram-стиль).
  const voice = useVoiceRecorder({
    onRecorded: (file) => {
      chatActions.end()
      if (!activeId) return
      sendFiles({ replyToId: replyTo?.id, files: [file] })
    },
    // Собеседник видит «записывает голосовое…» всё время записи — это самый длинный
    // промежуток в чате, когда снаружи не происходит ничего.
    onStart: () => {
      if (activeId) chatActions.begin(activeId, 'RECORDING_VOICE')
    },
    onStop: () => chatActions.end(),
    onError: (kind) => {
      chatActions.end()
      toast.error(t(kind === 'unsupported' ? 'recordUnsupported' : 'recordDenied'))
    },
  })
  // Запись кружка (видеосообщения): по завершению уходит так же сразу, вложением с флагом.
  // Подписи «записывает…» на время записи нет: у действий чата нет «записывает видео», а
  // «записывает голосовое» было бы неправдой. Загрузку собеседник увидит как «отправляет видео».
  const round = useRoundVideoRecorder({
    onRecorded: (file) => {
      if (!activeId) return
      sendFiles({ replyToId: replyTo?.id, files: [file], videoNote: true })
    },
    onError: (kind) => {
      toast.error(
        t(kind === 'unsupported' ? 'tgMessage.roundUnsupported' : 'tgMessage.roundDenied'),
      )
    },
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
        // Цитата и «без звука» — тоже часть сообщения: повтор без них уходил обычным ответом
        // и будил получателей.
        replyQuote?: string
        silent?: boolean
        files: File[]
        spoilerIndexes?: number[]
        asFiles?: boolean
        videoNote?: boolean
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
    return sendMessageWithDirectUpload(chatId, fields, files, {
      onProgress: (fraction) => setUploadProgress(chatId, tempId, fraction),
      signal,
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

    // «Отправляет фото…» показываем не сразу: сжатый снимок улетает за доли секунды, и подпись
    // успела бы только мигнуть. Ждём UPLOAD_ACTION_DELAY_MS — за это время короткая загрузка
    // успевает закончиться, и собеседник ничего лишнего не увидит.
    const uploadAction = uploadActionOf(files)
    const actionDelay = uploadAction
      ? setTimeout(() => chatActions.begin(chatId, uploadAction), UPLOAD_ACTION_DELAY_MS)
      : null

    try {
      // Сжимаем здесь, а не перед показом пузыря: пузырь уже висит в ленте с локальным
      // превью, и ждать ради него пережатия одиннадцати снимков незачем. «Без сжатия» —
      // единственный режим, где байты уходят ровно те, что выбрали.
      // «Без сжатия» отправляет байты как есть — но HEIC так не дойдёт вовсе: сервер не
      // принимает этот тип. Его переводим в JPEG в обоих режимах, остальное не трогаем.
      const payloadFiles = fields.asFiles
        ? await convertUnsupportedImages(files)
        : await compressImages(files)
      // Повторная проверка размера уже по итоговым байтам: при выборе снимок мерился самым
      // мягким лимитом, потому что сжатие ещё впереди, — здесь видно, помогло ли оно.
      const oversize = payloadFiles.find((f) => f.size > maxUploadBytes(f.type))
      if (oversize) {
        throw new OversizeAttachmentError(oversize)
      }
      // Сигнатура пузыря — по байтам, которые уйдут на сервер: эхо придёт с размерами уже
      // сжатых файлов, и по исходным сверка промахивалась — пузыри доставались чужим эхо.
      const waiting = pendingMedia.current.find((p) => p.tempId === tempId)
      if (waiting) waiting.sig = mediaSig(payloadFiles)
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
      // Подпись снимаем в finally: отмена, ошибка сети и успешная отправка должны гасить её
      // одинаково, иначе у собеседника останется «отправляет файл…» от загрузки, которой нет.
      if (actionDelay) clearTimeout(actionDelay)
      if (uploadAction) chatActions.end()
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
    videoNote?: boolean
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
      videoNote: payload.videoNote,
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
      // Оптимистичная цитата ответа для медиа-сообщения (вложенный блок виден сразу) — с
      // миниатюрой первого вложения оригинала, как её потом пришлёт сервер.
      replyTo:
        replyTo && replyTo.id === payload.replyToId
          ? {
              id: replyTo.id,
              content: replyTo.content,
              senderId: replyTo.senderId,
              sender: replyTo.sender,
              media: replyTo.media.slice(0, 1),
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
      replyQuote: payload.replyQuote,
      silent: payload.silent,
      files: payload.files,
      spoilerIndexes: payload.spoilerIndexes,
      asFiles: payload.asFiles,
      videoNote: payload.videoNote,
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
      videoNote: payload.videoNote,
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
      })
    })
  }

  // Вход/выход из комнаты чата при смене активного чата.
  useEffect(() => {
    if (!socket || !activeId) return
    socket.emit('chat:join', { chatId: activeId })
    setReplyTo(null)
    setReplyQuote(null)
    setAttachFiles([])
    setAttachOpen(false)
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
        const requestedAt = Date.now()
        const delta = await fetchChatUpdates(chatId, since, lastSyncAt.current)
        // Расхождение часов: серверный момент выборки против середины запроса по своим.
        clockSkewMs.current = new Date(delta.syncedAt).getTime() - (requestedAt + Date.now()) / 2
        if (delta.overflow) {
          void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
        } else {
          qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
            mergeUpdates(old, delta),
          )
        }
        // Плашку закреплённых дельта не обновляет: снятый или удалённый за время обрыва
        // закреп висел бы в ней до следующего события закрепления.
        void qc.invalidateQueries({ queryKey: chatKeys.pinned(chatId) })
        lastSyncAt.current = delta.syncedAt
      } catch {
        void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
      }
    }

    // Список чатов здесь не перезапрашиваем: его обновит общий ресинк реконнекта — с
    // разбросом во времени, а не всеми клиентами в одну секунду после деплоя (F-F13).
    const onConnect = (): void => {
      setConnected(true)
      if (activeId) {
        socket.emit('chat:join', { chatId: activeId })
        void catchUp(activeId)
      }
    }
    const onDisconnect = (): void => {
      setConnected(false)
      // До этого момента события приходили — с него и запрашиваем правки при догоне.
      lastSyncAt.current = serverNowIso(clockSkewMs.current)
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
          patchChatList((list) => withNewMessage(list, message))
          refreshChatList(chatId)
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
          // «Прыгнутое» окно (§9.4): ниже загруженного ещё есть сообщения, и хвост кэша — не
          // низ чата. Живое сообщение в хвосте встало бы после разрыва, а отметка прочтения
          // по нему погасила бы всё непросмотренное между. Его подгрузит прокрутка вниз.
          if (canLoadNewer) {
            skippedLiveRef.current = true
            return listOld
          }
          return listOld.some((m) => m.id === message.id) ? listOld : [...listOld, message]
        })
      }
      // Сообщение в руках — превью и порядок строки сразу; счётчик принесёт сервер.
      patchChatList((list) => withNewMessage(list, message))
      refreshChatList(chatId)
    },
  )
  // Список чатов живёт на `chat:activity`: его получает каждый участник на каждое сообщение.
  // Уведомление о сообщении (MESSAGE) приходит следом о том же самом — второй перезапрос
  // ничего бы не добавил. Остальные уведомления о чатах (запрос на переписку и т. п.) —
  // склеенно, по их чату; уведомления не о чатах список не трогают.
  useRealtimeEvent<{ notification?: { type?: string; data?: Record<string, unknown> | null } }>(
    'notification:new',
    (p) => {
      const n = p?.notification
      const chatId = n?.data?.chatId
      if (!n || n.type === 'MESSAGE' || typeof chatId !== 'string') return
      refreshChatList(chatId)
    },
  )
  // Тихий сигнал активности в чате (в т.ч. по заглушённым чатам): держим список живым без уведомления.
  // Опрос обновился (кто-то проголосовал) — инвалидируем его результаты (§39, live).
  useRealtimeEvent('poll:updated', (p: { pollId: string }) => {
    void qc.invalidateQueries({ queryKey: chatKeys.poll(p.pollId) })
  })
  useRealtimeEvent<{ chatId?: string }>('chat:activity', (p) => {
    refreshChatList(p?.chatId)
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
      if (pendingEditRef.current?.message.id === message.id) pendingEditRef.current = null
      upsert(message, chatId)
      // Правка последнего сообщения (и подтянувшееся превью ссылки) — в превью строки на месте.
      // Перезапрос не нужен: о правке последнего сервер и так шлёт `chat:activity`.
      patchChatList((list) => withEditedMessage(list, message))
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
  // Чек-лист изменили (пункт добавили, убрали или отметили) — кладём его прямо в сообщение.
  useRealtimeEvent<{ checklistId: string; chatId: string; checklist: MessageChecklist }>(
    'checklist:updated',
    ({ checklistId, chatId, checklist }) => {
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
        old?.map((m) => (m.checklist?.id === checklistId ? { ...m, checklist } : m)),
      )
    },
  )
  // Трансляция геопозиции: новая точка или остановка — в сообщение ленты этого чата.
  // Сообщение другого чата хелпер не тронет: сверяет и chatId, и id сообщения.
  useRealtimeEvent<{ chatId: string; messageId: string; location: MessageLocation }>(
    'location:updated',
    (update) => {
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(update.chatId), (old) =>
        applyLocationUpdate(old, update),
      )
    },
  )
  // «Удалить у себя» с другого устройства — убираем сообщения из ленты этого чата.
  useRealtimeEvent<{ chatId: string; messageIds: string[] }>(
    'message:hidden',
    ({ chatId, messageIds }) => {
      const hidden = new Set(messageIds)
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
        old?.filter((m) => !hidden.has(m.id)),
      )
    },
  )
  // Посторонних для открытого чата хранилище отбрасывает само.
  useRealtimeEvent<{ userId: string; online: boolean }>(
    'presence:changed',
    ({ userId, online }) => {
      presenceStore.apply(userId, online)
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
        // #6: «кто прочитал» для счётчика у своих сообщений — правим на месте из события.
        // Перезапрос на каждое прочтение в большой группе давал N×M запросов (F-F22).
        qc.setQueryData<ChatReadReceipt[]>(chatKeys.reads(chatId), (old) =>
          old ? withReceipt(old, userId, readAt) : old,
        )
      }
      // Галочки в превью — из самого события: в большой группе прочтения идут потоком, и
      // перезапрос списка на каждое забивал сеть и перерисовывал боковую колонку.
      patchChatList((list) => withOthersRead(list, chatId, readAt))
    },
  )

  /** Поправить закэшированный список на месте (без запроса). */
  function patchChatList(patch: (list: ChatListItem[]) => ChatListItem[]): void {
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) => (old ? patch(old) : old))
  }

  // Чаты, о которых пришли события с прошлого обновления списка. Нет какого-то в свежей
  // первой странице — значит, событие не подняло его наверх, и нужен полный перезапрос.
  const listPendingRef = useRef(new Set<string>())
  const listNeedsFullRef = useRef(false)

  /**
   * Обновление списка по событиям (F-F02): одна свежая первая страница поверх кэша вместо
   * перекачки всех страниц. Полный перезапрос остаётся фолбэком — кэша ещё нет, чат события
   * не в первой странице, страница не пришла.
   */
  async function refreshListHead(): Promise<void> {
    const key = chatKeys.list()
    const pending = [...listPendingRef.current]
    const needsFull = listNeedsFullRef.current
    listPendingRef.current.clear()
    listNeedsFullRef.current = false
    if (needsFull || !qc.getQueryData<ChatListItem[]>(key)) {
      await qc.invalidateQueries({ queryKey: key })
      return
    }
    const startedAt = Date.now()
    let head: Awaited<ReturnType<typeof fetchChatsHead>>
    try {
      head = await fetchChatsHead()
    } catch {
      await qc.invalidateQueries({ queryKey: key })
      return
    }
    // Полный перезапрос, начатый после нашего, свежее страницы — список обновит он.
    if (fullListFetchAtRef.current >= startedAt) return
    // Начатый раньше ещё идёт и затрёт слияние старыми данными — перезапускаем его.
    if (qc.getQueryState(key)?.fetchStatus === 'fetching') {
      await qc.invalidateQueries({ queryKey: key })
      return
    }
    const inHead = new Set(head.items.map((c) => c.id))
    const merged =
      head.complete || pending.every((id) => inHead.has(id))
        ? mergeChatHead(qc.getQueryData<ChatListItem[]>(key) ?? [], head.items, head.complete)
        : null
    if (merged) qc.setQueryData<ChatListItem[]>(key, merged)
    else await qc.invalidateQueries({ queryKey: key })
  }
  const refreshListHeadRef = useRef(refreshListHead)
  refreshListHeadRef.current = refreshListHead
  const [listRefresher] = useState(() =>
    createRefreshCoalescer(() => refreshListHeadRef.current(), {
      minIntervalMs: LIST_REFRESH_MIN_INTERVAL_MS,
      maxWaitMs: LIST_REFRESH_MAX_WAIT_MS,
    }),
  )
  useEffect(() => () => listRefresher.cancel(), [listRefresher])

  /**
   * Обновить список чатов по событию в чате `chatId` — склеенно с остальными событиями.
   *
   * Событие в чате, который человек сейчас читает, — когда события затихнут: сервер ещё
   * считает новое сообщение непрочитанным (отметка уйдёт через ~1 с), и немедленный
   * перезапрос перетирал локальный 0 — счётчик мигал 0 → 1 → 0. Остальные чаты — почти сразу.
   */
  function refreshChatList(chatId?: string): void {
    if (chatId) listPendingRef.current.add(chatId)
    else listNeedsFullRef.current = true
    const reading =
      !!chatId &&
      chatId === activeId &&
      typeof document !== 'undefined' &&
      !document.hidden &&
      peekChatIdRef.current !== chatId
    if (reading) listRefresher.settle(LIST_REFRESH_READING_MS)
    else listRefresher.soon(LIST_REFRESH_MS)
  }
  // Своё прочтение с другого устройства (или подтверждение этого): сервер шлёт его в личную
  // комнату. Дочитано до последнего сообщения — счётчик строки гасим на месте; иначе остаток
  // знает только сервер, и список перезапрашивается, когда отметки затихнут.
  useRealtimeEvent<{ chatId: string; readAt: string }>('chat:read', ({ chatId, readAt }) => {
    scheduleChatsUnreadRefresh(qc, true)
    const list = qc.getQueryData<ChatListItem[]>(chatKeys.list())
    const next = list ? withOwnRead(list, chatId, readAt) : null
    if (next) {
      if (next !== list) qc.setQueryData<ChatListItem[]>(chatKeys.list(), next)
      return
    }
    listPendingRef.current.add(chatId)
    listRefresher.settle(LIST_REFRESH_READING_MS)
  })
  // Отказы чат-событий сокета (§9.1): сервер отвечает на них событием `error` с кодом, и
  // без подписки правка после окна, удаление чужого, RATE_LIMIT и MAINTENANCE проходили для
  // интерфейса как выполненные (FRONTEND_RULES §5.4).
  useRealtimeEvent<{ event?: string; code?: string }>('error', (payload) => {
    const event = payload?.event
    if (!event || !WS_ERROR_EVENTS.has(event)) return
    const code = payload.code && WS_ERROR_CODES.has(payload.code) ? payload.code : 'INTERNAL_ERROR'
    if (event === 'message:send') {
      // Какому пузырю отказали, событие не говорит: «отправляется» гасим у всех — их можно
      // повторить, а молча висящий пузырь превратился бы в «ошибку» только через 12 секунд.
      setSendState((s) => {
        const next = { ...s }
        for (const key of Object.keys(next)) if (next[key] === 'pending') next[key] = 'failed'
        return next
      })
    }
    if (event === 'message:edit' && pendingEditRef.current) {
      // Текст правки не теряем: возвращаем его в поле ввода в режиме правки.
      const { message, content } = pendingEditRef.current
      pendingEditRef.current = null
      setEditing(message)
      setText(content)
    }
    toast.error(tErr(code))
  })
  useRealtimeEvent<{ messageId: string; chatId: string }>(
    'message:deleted',
    ({ messageId, chatId }) => {
      if (chatId === activeId) {
        // Ответы на удалённое теряют и его текст в цитате — так же их отдаст и сервер.
        const deletedAt = new Date().toISOString()
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
          (old ?? [])
            .filter((m) => m.id !== messageId)
            .map((m) =>
              m.replyTo?.id === messageId
                ? { ...m, replyQuote: null, replyTo: { ...m.replyTo, content: '', deletedAt } }
                : m,
            ),
        )
      }
      // Удалённое могло быть закреплённым — иначе оно висело бы в плашке у остальных.
      void qc.invalidateQueries({ queryKey: chatKeys.pinned(chatId) })
      // Удаление последнего сообщения меняет превью списка, непрочитанного — счётчик.
      refreshChatList(chatId)
    },
  )
  // Только `chat:action`: сервер шлёт рядом и старые typing:started/typing:stopped, но они
  // для клиентов прошлой версии — здесь это был бы тот же факт вторым путём.
  useRealtimeEvent<{ chatId: string; userId: string; action: ChatAction | null }>(
    'chat:action',
    ({ chatId, userId, action }) => {
      if (userId === myId) return
      setActionsByChat((prev) => applyAction(prev, chatId, userId, action))
    },
  )

  // Автоочистка подписей без подтверждения (см. ACTION_TTL_MS). Нужна не только от потерянного
  // «стоп»: человек мог закрыть вкладку, и подпись висела бы вечно — в строке списка это
  // заметнее, чем в шапке, потому что туда никто не заходит её сбрасывать.
  useEffect(() => {
    const timer = setInterval(() => setActionsByChat((prev) => sweepActions(prev)), 2000)
    return () => clearInterval(timer)
  }, [])

  // Ушли из чата — действие закончилось. Без этого «печатает…» висело бы в покинутом диалоге
  // до таймаута: набор текста явного «стоп» не шлёт.
  useEffect(() => {
    return () => chatActionsRef.current.end()
  }, [activeId])

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

  // Новый чат — прочтение начинается заново: плашку «Непрочитанные» и отметку «прочитано до»
  // ставит первичный скролл, когда лента загрузится. Недоотправленную отметку прошлого чата
  // отправляем сразу, а не теряем при переключении.
  // Курсоры истории этого чата: сохранённые — как были; кэш без сохранённых (чат открыт в
  // этой вкладке впервые после перезагрузки страницы) — старее самого старого загруженного.
  useEffect(() => {
    if (!activeId) return
    const saved = pagerByChatRef.current.get(activeId)
    if (saved) {
      setOlderCursor(saved.older)
      setCanLoadOlder(saved.canOlder)
      setNewerCursor(saved.newer)
      setCanLoadNewer(saved.canNewer)
      return
    }
    const cached = qc.getQueryData<ChatMessage[]>(chatKeys.messages(activeId))
    setOlderCursor(cached?.[0]?.id)
    setCanLoadOlder(!!cached?.length)
    setNewerCursor(undefined)
    setCanLoadNewer(false)
    // qc стабилен; эффект — ровно на смену чата.
  }, [activeId])

  useEffect(() => {
    setUnreadDividerId(null)
    readUpToRef.current = null
    setReadUpTo(null)
    // Лента перемонтирована (key={activeId}) и стоит наверху: первичный скролл нужен заново,
    // в том числе при повторном открытии ТОГО ЖЕ чата (на телефоне «назад» и снова в чат —
    // раньше он открывался в самом верху истории).
    scrolledForRef.current = null
    // Отложенная доводка прошлого чата не должна сработать по индексам нового.
    if (openRafRef.current !== null) cancelAnimationFrame(openRafRef.current)
    if (openTimeoutRef.current !== null) window.clearTimeout(openTimeoutRef.current)
    openRafRef.current = null
    openTimeoutRef.current = null
    return () => flushRead()
    // flushRead читает refs — актуальный на момент ухода из чата, пересоздавать эффект незачем.
  }, [activeId])

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
      setShowScrollDown(false)
      // Как в Telegram: чат с непрочитанным открывается на первом непрочитанном, а не в самом
      // низу. Раньше лента сразу уезжала вниз и тут же отправляла «прочитано» по последнему
      // сообщению — двадцать непрочитанных гасли, хотя человек их не видел.
      const atOpen = chatsRef.current?.find((c) => c.id === activeId)
      // Сервер знает первое непрочитанное по id — по нему плашка встаёт точно, в том числе
      // в окне вокруг него; старый сервер — отсчёт чужих сообщений с конца, как раньше.
      const firstUnread = firstUnreadPosition(list, atOpen, myId)
      setUnreadDividerId(firstUnread === null ? null : (list[firstUnread]?.id ?? null))
      // Всё, что выше первого непрочитанного, уже прочитано; пустая строка — «ничего», если
      // непрочитанным оказалось всё загруженное.
      //
      // Непрочитанных по списку нет — всё до ПОСЛЕДНЕГО считаем прочитанным, а само последнее
      // отправим по факту показа. Раньше прочитанным сразу считалось и оно: отметка не уходила
      // вовсе, и если список ошибался (открыли по ссылке, пока он не загрузился; последним
      // было своё сообщение), сервер так и считал чат непрочитанным.
      readUpToRef.current =
        firstUnread === null
          ? list.length > 1
            ? (list[list.length - 2]?.createdAt ?? '')
            : ''
          : firstUnread > 0
            ? (list[firstUnread - 1]?.createdAt ?? '')
            : ''
      setReadUpTo(readUpToRef.current)
      const position = (): void => {
        // Едем к конкретному сообщению (открыли по ссылке) — начальная позиция не нужна.
        if (focusTargetRef.current) return
        if (firstUnread === null) toBottom('auto')
        else virtualizerRef.current?.scrollToIndex(firstUnread, { align: 'start' })
      }
      openRafRef.current = requestAnimationFrame(() => {
        openRafRef.current = null
        position()
        // Второй проход — после того как virtua измерила строки: первая раскладка идёт по
        // оценке высот. Прочтение отмечаем уже по настоящему кадру.
        openTimeoutRef.current = window.setTimeout(() => {
          openTimeoutRef.current = null
          position()
          // Открыт в самом низу — держимся низа, пока догружаются снимки и карточки.
          wasAtBottomRef.current = firstUnread === null && !focusTargetRef.current
          markVisibleReadRef.current()
        }, 120)
      })
      return
    }

    if (last && last.id !== prevLastId) {
      if (last.senderId === myId || nearBottom()) {
        toBottom('smooth')
        // Прочитано — то, что оказалось на экране после доводки прокрутки.
        window.setTimeout(() => markVisibleReadRef.current(), 350)
      } else {
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

  // Догрузились снимок, видео, превью ссылки или карточка — строка выросла уже после
  // первичного скролла, и последнее сообщение уезжало под панель ввода. Стоявшего внизу
  // держим внизу. Новое сообщение сюда не относится: его доводит эффект выше, плавно, —
  // поэтому рост из-за смены последнего сообщения пропускаем.
  const isLoadingMessages = messages.isLoading
  useEffect(() => {
    const el = messagesScrollRef.current
    const content = el?.firstElementChild
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    let seenLastId = lastMsgIdRef.current
    const ro = new ResizeObserver(() => {
      if (seenLastId !== lastMsgIdRef.current) {
        seenLastId = lastMsgIdRef.current
        return
      }
      if (wasAtBottomRef.current && !loadingOlderRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [activeId, isLoadingMessages])

  // Пометка дня (§6). Она живёт в потоке ленты, перед первым сообщением дня, и
  // прокручивается вместе с ним. Прилипший заголовок наверху — её подмена на время,
  // пока сама пометка уехала под верх: тогда дата всё равно видна, а когда пометка
  // возвращается в кадр, заголовок гаснет, чтобы не было двух одинаковых дат.
  // (Настоящий `position: sticky` не годится: virtua оборачивает каждое сообщение,
  // и прилипало бы в пределах одного сообщения, а не до следующей даты.)
  //
  // Решает это одно измерение: какое сообщение сейчас вверху кадра, начинается ли с него
  // день и насколько оно уже ушло под верх. Зовётся и на прокрутке, и после открытия чата.
  function syncFloatingDay(): void {
    const data = messages.data
    if (!data || data.length === 0) {
      setFloatingDay(null)
      setFloatingDayShown(false)
      return
    }
    const vh = virtualizerRef.current
    if (!vh) {
      // Виртуализатор ещё не смонтирован — мерить нечем. Текст заголовку готовим, но
      // показывать не начинаем: встроенная пометка сейчас на экране, и заголовок дал бы
      // вторую такую же дату. Ошибиться в эту сторону дешевле: промах здесь стоит
      // одного кадра до первой прокрутки, промах в другую — видимого дубля.
      const last = data[data.length - 1]
      if (last) {
        setFloatingDay(dayLabel(last.createdAt))
        setFloatingDayAt(last.createdAt)
      }
      setFloatingDayShown(false)
      return
    }
    const topIdx = Math.min(Math.max(vh.findItemIndex(vh.scrollOffset), 0), data.length - 1)
    const top = data[topIdx]
    if (!top) return
    setFloatingDay(dayLabel(top.createdAt))
    setFloatingDayAt(top.createdAt)
    const prev = data[topIdx - 1]
    const startsDay =
      !prev || new Date(prev.createdAt).toDateString() !== new Date(top.createdAt).toDateString()
    // Насколько верхнее сообщение уже ушло под верх: пока меньше высоты пометки,
    // она видна целиком и подменять её нечем.
    const scrolledInto = vh.scrollOffset - vh.getItemOffset(topIdx)
    setFloatingDayShown(!startsDay || scrolledInto > DAY_LABEL_H)
  }

  // Начальная пометка дня: лента открывается внизу, и до первого скролла обработчик
  // не сработает — без этого заголовок дня появлялся бы только после касания колеса.
  //
  // Через кадр, а не сразу: virtua на момент эффекта ещё не разложила ленту, и мерить
  // нечего. Раньше здесь мерить и не пытались — заголовок поднимали по догадке «первый и
  // последний день разные, значит пометка уехала под верх». Догадка врала каждый раз,
  // когда переписка целиком помещается на экране: встроенная пометка видна, а заголовок
  // всё равно показывался, и «Сегодня» оказывалось на экране дважды.
  useEffect(() => {
    const id = requestAnimationFrame(syncFloatingDay)
    return () => cancelAnimationFrame(id)
    // Пересчёт при смене чата и подгрузке истории; дальше день ведёт onMessagesScroll.
  }, [activeId, messages.data])

  // Скролл ленты: показ кнопки «вниз», отметка прочтения при доскролле вниз, авто-догрузка старых у верха.
  function onMessagesScroll(): void {
    const el = messagesScrollRef.current
    if (!el) return
    syncFloatingDay()
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setShowScrollDown(!atBottom)
    // Прочитано то, что проехало через экран, — на каждом шаге прокрутки, а не только
    // у самого низа: как в Telegram, счётчик тает по мере чтения.
    markVisibleRead()
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
      setPager(id, { newer: undefined, canNewer: false })
      scrolledForRef.current = null
      void qc.invalidateQueries({ queryKey: chatKeys.messages(id) })
    } else {
      const len = messages.data?.length ?? 0
      const el = messagesScrollRef.current
      // Плавно — только последний экран-другой. Издалека плавная прокрутка через
      // неизмеренные строки шла долго и часто не доезжала: высоты по пути уточнялись.
      const far = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 2
      if (len > 0) virtualizerRef.current?.scrollToIndex(len - 1, { align: 'end', smooth: !far })
      wasAtBottomRef.current = true
    }
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
  /** Выбранные сообщения в порядке ленты, а не в порядке кликов. */
  function selectedInOrder(): ChatMessage[] {
    return (messages.data ?? []).filter((m) => selectedIds.has(m.id))
  }
  // Удалить можно только свои: чужие сервер отклоняет, и раньше они молча оставались.
  const ownSelectedCount = useMemo(
    () => (messages.data ?? []).filter((m) => selectedIds.has(m.id) && m.senderId === myId).length,
    [messages.data, selectedIds, myId],
  )
  function bulkDelete(): void {
    if (!socket) return
    const own = selectedInOrder().filter((m) => m.senderId === myId)
    own.forEach((m) => socket.emit('message:delete', { messageId: m.id }))
    if (own.length < selectedIds.size) toast.info(t('deleteOthersSkipped'))
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

  /** Отправить накопленную отметку о прочтении сейчас (уход из чата, закрытие вкладки). */
  function flushRead(): void {
    if (readTimerRef.current) {
      window.clearTimeout(readTimerRef.current)
      readTimerRef.current = null
    }
    const pending = pendingReadRef.current
    pendingReadRef.current = null
    if (pending) emitRead(pending.chatId, pending.id)
  }

  /**
   * Прочитано то, что человек увидел: последнее сообщение над нижней кромкой ленты (над
   * панелью ввода — на телефоне она лежит поверх ленты). Только вперёд, только в видимой
   * вкладке и не в режиме «открыть без прочтения».
   *
   * Счётчик в списке чатов правим сразу — остаток чужих сообщений ниже прочитанного, как
   * его посчитает сервер; сама отметка уходит не чаще раза в READ_EMIT_MS.
   */
  function markVisibleRead(): void {
    const chatId = activeId
    const data = messages.data
    const vh = virtualizerRef.current
    if (!chatId || !data?.length || !vh) return
    if (typeof document !== 'undefined' && document.hidden) return
    if (peekChatIdRef.current === chatId) return
    // viewportSize у virtua — высота БЕЗ отступов контейнера (contentRect), а нижний отступ
    // ленты и есть место под панелью ввода. Вычитать composerH ещё раз значило поднять
    // границу на высоту панели: короткое последнее сообщение так и не считалось прочитанным,
    // а бейдж в навигации висел.
    const bottom = Math.max(0, vh.scrollOffset + vh.viewportSize)
    let idx = Math.min(Math.max(vh.findItemIndex(bottom), 0), data.length - 1)
    // Своё недоотправленное сообщение (временный id) сервер не знает — берём ближайшее
    // настоящее выше него.
    while (idx >= 0 && data[idx]?.id.startsWith('tmp:')) idx -= 1
    const msg = data[idx]
    if (!msg) return
    if (readUpToRef.current !== null && msg.createdAt <= readUpToRef.current) return
    readUpToRef.current = msg.createdAt
    setReadUpTo(msg.createdAt)
    pendingReadRef.current = { chatId, id: msg.id }
    if (!readTimerRef.current) readTimerRef.current = window.setTimeout(flushRead, READ_EMIT_MS)
    // В «прыгнутом» окне ниже загруженного есть ещё сообщения — остаток отсюда не посчитать,
    // его пришлёт сервер (chat:read → список перезапросится).
    if (canLoadNewer) return
    const remaining = unreadAfter(data, msg.createdAt, myId)
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
      (old ?? []).map((c) =>
        c.id === chatId ? { ...c, unreadCount: remaining, unread: remaining > 0 } : c,
      ),
    )
  }
  // Свежая версия для слушателей окна (фокус, видимость вкладки): те живут дольше рендера.
  const markVisibleReadRef = useRef(markVisibleRead)
  markVisibleReadRef.current = markVisibleRead

  // Вернулись во вкладку — дочитываем то, что на экране: пока она была скрыта, «прочитано»
  // не ставилось. Закрывают вкладку — отправляем накопленную отметку, а не теряем её.
  useEffect(() => {
    const onVisible = (): void => {
      if (!document.hidden) markVisibleReadRef.current()
    }
    const onHide = (): void => flushRead()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  // Непрочитанных ниже того, что видно, — число на кнопке «вниз», как в Telegram. Считается
  // от отметки «прочитано до», поэтому тает вместе с прокруткой, а новые чужие сообщения,
  // пришедшие, пока человек читает выше, его увеличивают.
  // В «прыгнутом» окне (открыли на первом непрочитанном, перешли к сообщению) ниже
  // загруженного есть ещё сообщения — там число берём у сервера, как Telegram.
  const unreadBelow = useMemo(() => {
    const local = unreadAfter(messages.data ?? [], readUpTo, myId)
    if (!canLoadNewer) return local
    return Math.max(local, chats.data?.find((c) => c.id === activeId)?.unreadCount ?? 0)
  }, [messages.data, readUpTo, myId, canLoadNewer, chats.data, activeId])

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
    opts: { replyQuote?: string; silent?: boolean; noLinkPreview?: boolean } = {},
  ): void {
    const tempId = `tmp:${nonce}`
    setSendState((s) => ({ ...s, [tempId]: 'pending' }))
    // Повтор зависшего сообщения шлёт его заново — «без превью» должно повториться тоже.
    if (opts.noLinkPreview) noPreviewNonces.current.add(nonce)
    socket?.emit('message:send', {
      chatId,
      content,
      replyToId,
      // Цитата без ответа схемой запрещена — шлём только парой.
      ...(replyToId && opts.replyQuote ? { replyQuote: opts.replyQuote } : {}),
      ...(opts.silent ? { silent: true } : {}),
      ...(opts.noLinkPreview ? { noLinkPreview: true } : {}),
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
        replyQuote: media.replyQuote,
        silent: media.silent,
        files: media.files,
        spoilerIndexes: media.spoilerIndexes,
        asFiles: media.asFiles,
        videoNote: media.videoNote,
      })
      return
    }
    emitSend(m.chatId, m.id.slice(4), m.content, m.replyToId ?? undefined, {
      replyQuote: m.replyQuote ?? undefined,
      silent: m.silent,
      noLinkPreview: noPreviewNonces.current.has(m.id.slice(4)),
    })
  }

  function send(opts: { silent?: boolean } & ComposerSendOptions = {}): void {
    const content = text.trim()
    if (!activeId) return
    // Режим правки: редактируем существующее сообщение (сервер эхом пришлёт message:updated).
    if (editing) {
      if (content && socket) {
        pendingEditRef.current = { message: editing, content }
        socket.emit('message:edit', {
          messageId: editing.id,
          content,
          ...(opts.noLinkPreview ? { noLinkPreview: true } : {}),
        })
      }
      setEditing(null)
      setText('')
      composerRef.current?.focus()
      return
    }
    // Пересылка над полем (П.32): текст из поля уходит комментарием перед ней, одной пачкой.
    // Поле чистим сразу, как при обычной отправке; не ушло — возвращаем текст на место.
    if (forward.active) {
      if (forward.sending) return
      const chatId = activeId
      void forward.send({ comment: content, noLinkPreview: opts.noLinkPreview }).then((ok) => {
        if (!ok && content) setText((cur) => (cur ? cur : content))
      })
      setText('')
      draftsRef.current.delete(chatId)
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      void saveChatDraft(chatId, '').catch(() => undefined)
      setMentionQuery(null)
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
      silent: !!opts.silent,
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
            media: replyTo.media.slice(0, 1),
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
      silent: opts.silent,
      noLinkPreview: opts.noLinkPreview,
    })
    chatActions.end()
    setText('')
    draftsRef.current.delete(activeId)
    // #3: отправили — гасим серверный черновик (и локальный таймер сохранения).
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    void saveChatDraft(activeId, '')
      .then(applySavedDraft)
      .catch(() => undefined)
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
    scrollToAndHighlight(idx, messageId, 'center')
  }

  /**
   * Прокрутить к строке и только ПОТОМ подсветить — как в Telegram: подсветка, вспыхнувшая в
   * начале плавной прокрутки, к приезду уже гасла, и человек не видел, куда его привезли.
   * Ждём остановки прокрутки, доводим строку на место без анимации (virtua к этому моменту
   * измерила настоящие высоты, первая прокрутка шла по оценке) и тогда подсвечиваем.
   */
  function scrollToAndHighlight(idx: number, id: string, align: 'center' | 'start'): void {
    focusTargetRef.current = id
    wasAtBottomRef.current = false
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
    setHighlightId(null)
    virtualizerRef.current?.scrollToIndex(idx, { align, smooth: true })
    afterScrollSettles(() => {
      virtualizerRef.current?.scrollToIndex(idx, { align })
      requestAnimationFrame(() => {
        if (focusTargetRef.current === id) focusTargetRef.current = null
        setHighlightId(id)
        highlightTimerRef.current = window.setTimeout(
          () => setHighlightId((cur) => (cur === id ? null : cur)),
          1600,
        )
      })
    })
  }

  // ── Тач-жесты по сообщению (мобильный) ──────────────────────────────────────
  // Долгое нажатие → меню действий; свайп влево → ответ (Telegram). На десктопе жесты не мешают
  // (нет touch), контекстное меню/hover-кнопки остаются. touch-action:pan-y на строке
  // отдаёт вертикальный скролл браузеру, а горизонтальный жест — нам.
  const LONG_PRESS_MS = 450
  const SWIPE_REPLY_PX = 64
  const swipeHintRef = useRef<SwipeReplyHintHandle>(null)
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
      swipeHintRef.current?.hide()
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
    // Свайп влево (преимущественно горизонтальный), как в Telegram, → сдвигаем пузырь, а
    // справа проступает значок «Ответить» (ui/message-list-swipe-hint).
    const pull = -dx
    if (pull > 0 && Math.abs(dy) < 24) {
      s.swiping = true
      // За порогом ответа пузырь не встаёт колом (было `Math.min(dx, 72)` — палец едет,
      // пузырь стоит, и жест читается как «заело»), а сопротивляется всё сильнее: §9.
      const shift = -(pull <= SWIPE_REPLY_PX
        ? pull
        : SWIPE_REPLY_PX + rubberband(pull - SWIPE_REPLY_PX, s.bubble?.offsetWidth ?? 240))
      if (s.bubble) {
        s.bubble.style.transition = 'none'
        s.bubble.style.transform = `translateX(${shift}px)`
        swipeHintRef.current?.update(s.bubble, shift, SWIPE_REPLY_PX)
      }
      // Один тик ровно в момент пересечения порога — палец узнаёт, что отпускать уже можно,
      // не глядя на экран (§13: обратная связь на причинном событии, а не в конце).
      if (!s.reachedReply && pull > SWIPE_REPLY_PX) {
        s.reachedReply = true
        hapticTick()
      } else if (s.reachedReply && pull <= SWIPE_REPLY_PX) {
        s.reachedReply = false
      }
    } else if (s.swiping && pull <= 0) {
      resetBubble(s.bubble, false)
      swipeHintRef.current?.hide()
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
    swipeHintRef.current?.hide()
    // Свайп влево дальше порога (и это не было долгим нажатием) → ответ на сообщение.
    if (!s.longFired && s.swiping && -dx > SWIPE_REPLY_PX) setReplyTo(s.m)
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

  // Сохранённый черновик — сразу в строку списка: время и место строки, как в Telegram.
  function applySavedDraft(saved: SavedChatDraft): void {
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
      old ? withDraft(old, saved.chatId, saved.draft, saved.draftAt ?? null) : old,
    )
  }

  function onType(v: string): void {
    setText(v)
    if (activeId) {
      draftsRef.current.set(activeId, v)
      // #3: дебаунс-сохранение черновика на сервер (синхронизация между устройствами).
      const chatId = activeId
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      draftSaveTimer.current = setTimeout(() => {
        void saveChatDraft(chatId, v)
          .then(applySavedDraft)
          .catch(() => undefined)
      }, 800)
    }
    // Определяем @-запрос перед курсором для автодополнения упоминаний. Текст до
    // курсора берём у самого поля: значение `v` — это markdown всего сообщения, и по
    // нему позиция курсора не восстанавливается.
    const before = composerRef.current?.textBefore() ?? v
    const m = before.match(/(?:^|\s)@(\S*)$/)
    setMentionQuery(m ? (m[1] ?? '') : null)
    if (!socket || !activeId) return
    // Явного «перестал печатать» нет намеренно: подпись гаснет у получателя по таймауту.
    // Это дешевле лишнего события и переживает закрытие вкладки и потерю сети.
    chatActions.ping(activeId, 'TYPING')
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

  /**
   * Перетаскивание принимаем, только когда тащат файлы и в открытый чат, куда вообще можно
   * писать. Текст и ссылки из других вкладок сюда ронять незачем — их вставляют в поле.
   */
  function canDropFiles(e: DragEvent): boolean {
    if (!activeId || !connected || editing) return false
    return Array.from(e.dataTransfer?.types ?? []).includes('Files')
  }

  function addFiles(list: FileList | null, asFiles = false): void {
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
    if (!attachOpen) setAttachAsFiles(asFiles)
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
      setPager(activeId, { older: page.cursor, canOlder: page.hasNext })
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
      setPager(activeId, { newer: page.prevCursor, canNewer: page.hasPrev })
      // Дошли до низа, а живые сообщения, пропущенные в «прыгнутом» окне, могли прийти уже
      // после того, как сервер собрал эту страницу, — добираем их одним запросом от хвоста.
      const tailId = updated?.[updated.length - 1]?.id
      if (!page.hasPrev && skippedLiveRef.current && tailId) {
        skippedLiveRef.current = false
        const rest = await fetchMessages(activeId, {
          limit: 30,
          cursor: tailId,
          direction: 'newer',
        })
        const fresh = [...rest.items].reverse()
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(activeId), (old) => {
          const prev = old ?? []
          const seen = new Set(prev.map((m) => m.id))
          return [...prev, ...fresh.filter((m) => !seen.has(m.id))]
        })
      }
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
    setPager(activeId, {
      older: page.cursor,
      canOlder: page.hasNext,
      newer: page.prevCursor,
      canNewer: page.hasPrev,
    })
    return win
  }

  async function jumpToMessage(messageId: string): Promise<void> {
    if (!activeId) return
    focusTargetRef.current = messageId
    const win = applyMessageWindow(await fetchMessages(activeId, { limit: 30, around: messageId }))
    requestAnimationFrame(() => {
      const idx = win.findIndex((x) => x.id === messageId)
      if (idx >= 0) scrollToAndHighlight(idx, messageId, 'center')
      else focusTargetRef.current = null
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
      const hit = at >= 0 ? win[at] : undefined
      if (hit) scrollToAndHighlight(at, hit.id, 'start')
      else if (idx >= 0)
        virtualizerRef.current?.scrollToIndex(idx, { align: 'start', smooth: true })
    })
  }

  // Поиск по переписке в шапке (Telegram): состояние, выдача и шаги по совпадениям — в хуке.
  // Под старыми именами — то, что читают лента (подсветка) и панель ввода.
  const chatSearch = useChatHeaderSearch({
    chatId: activeId,
    jumpToMessage: (id) => void jumpToMessage(id),
  })
  const chatSearchOpen = chatSearch.open
  const chatSearchTerm = chatSearch.highlight
  // Переход к дате из поиска (#5): клик по числу сразу прокручивает историю к этому дню и
  // закрывает календарь. Будущее закрыто — сообщений там заведомо нет. Режим диапазона
  // очищает историю за период «у себя».
  const searchCalendar = (
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
      onViewChange={(y, m) => setCalendarMonth(`${y}-${String(m + 1).padStart(2, '0')}`)}
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
  )

  // Подпись действия для шапки (Telegram-стиль): в группе — с именем начавшего раньше всех.
  const actionSummary = summarizeActors(activeId ? actionsByChat[activeId] : undefined)
  const actorName = actionSummary
    ? membersQuery.data?.find(
        (u) =>
          u.id ===
          (actionSummary.kind === 'single' ? actionSummary.userId : actionSummary.firstUserId),
      )?.firstName
    : undefined
  const activeChat = chats.data?.find((c) => c.id === activeId)
  // Открытый чат пропал из списка — исключили, забанили, группу удалили, запрос отклонили
  // или скрыли на другом устройстве. Сервер шлёт об этом только `chat:activity`, и окно
  // оставалось открытым над чатом, где ничего уже нельзя. Закрываем, но только чат, который
  // в списке уже был: только что созданный появляется в нём не сразу.
  const seenInListRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeId) {
      seenInListRef.current = null
      return
    }
    if (activeChat) {
      seenInListRef.current = activeId
      return
    }
    if (chats.isSuccess && seenInListRef.current === activeId) {
      seenInListRef.current = null
      setActiveId(null)
      setDetailsOpen(false)
      toast.info(t('chatUnavailable'))
    }
  }, [activeId, activeChat, chats.isSuccess, t])
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
  // Личный чат без единого сообщения в списке не показываем. Он заводится уже по клику
  // «Написать» (startDirect), до всякой переписки, и, если человек передумал, в списке
  // оставалась бы карточка, за которой ничего нет — ни превью, ни времени, ни причины в
  // ней быть. Сервер так уже поступает с непринятым запросом у адресата, но своего
  // пустого чата инициатору не прячет: тот открыт и в нём как раз пишут (chats.service.ts,
  // фильтр `visible`). Поэтому фильтруем здесь, с двумя исключениями — открытый чат и
  // начатый черновик: иначе карточка исчезала бы из-под пальца ровно в тот момент, когда
  // человек к ней вернулся.
  //
  // Групповых и официальных чатов это не касается: туда добавили, и пустая группа —
  // такой же полноправный чат, из списка ей пропадать незачем.
  const list = useMemo(
    () =>
      (chats.data ?? []).filter(
        (c) => c.type !== 'PRIVATE' || c.lastMessage != null || !!c.draft || c.id === activeId,
      ),
    [chats.data, activeId],
  )
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

  const hasText = text.trim().length > 0
  // Кнопка отправки показывается при вводе/вложениях/правке; иначе — микрофон (Telegram-стиль).
  const showSend = !!editing || hasText
  const recMMSS = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`
  // Просмотры сообщений официального чата (как у постов канала): глаз и число в мете.
  const messageViews = useMessageViews(activeId, activeChat?.type, messages.data)
  const isPrivate = activeChat?.type === 'PRIVATE'
  // Имя показываем только в групповом чате: в личном собеседник и так один.
  const actionLabel = actionLabelOf(actionSummary, { name: actorName, withName: !isPrivate })
  // Из присутствия окно берёт только то, что рисует само; число «в сети» группы читает
  // подпись в шапке (ChatHeaderStatus) — его изменения окно не перерисовывают.
  const otherId = usePresence(presenceStore, (m) => peerIdOf(m, myId))
  const otherOnline = usePresence(presenceStore, (m) => {
    const peer = isPrivate ? peerIdOf(m, myId) : undefined
    return peer !== undefined && m.get(peer) === true
  })
  const anyOthersOnline = usePresence(presenceStore, (m) => othersOnlineCount(m, myId) > 0)
  // Когда собеседник был в сети (§49) — для подписи «был(а) …» в шапке.
  const peerLastSeenAt = isPrivate
    ? (membersQuery.data?.find((u) => u.id !== myId)?.lastSeenAt ?? null)
    : null
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
  // Escape закрывает панель деталей, открытую экраном: у полноэкранного слоя нет ни
  // затемнения, ни рамки, по которым видно «это поверх», и привычка закрыть с клавиатуры
  // остаётся единственным быстрым способом. В колонке на ПК закрывают крестиком.
  useEffect(() => {
    if (!detailsOpen || isWide) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailsOpen, isWide])

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

  // ── Лента в духе Telegram (lib/use-message-list-*, ui/message-list-*) ─────────
  // Кнопки «к упоминанию» и «к реакции» над «вниз», въезд нового сообщения, прилипшая дата
  // только во время прокрутки, двойной клик — реакция, протягивание мышью — выбор.
  const listAttention = useMessageListAttention({
    chatId: activeId,
    chat: activeChat,
    messages: messages.data,
    scrollRef: messagesScrollRef,
    // Как у отметки «прочитано до»: не в скрытой вкладке и не в «открыть без прочтения».
    canRead: () => !document.hidden && peekChatIdRef.current !== activeId,
  })
  useNewMessageAppear(messagesScrollRef, activeId, messages.data)
  useIncomingReactionPop({ chatId: activeId, myId, messages: messages.data })
  const listScrolling = useListScrolling(messagesScrollRef, activeId)
  const listGestures = useMessageListGestures({
    scrollRef: messagesScrollRef,
    messages: messages.data,
    selecting: selectMode,
    selectedIds,
    disabled: chatSearchOpen || !!activeChat?.requestIncoming,
    onDefaultReaction: (id, at) => reactTo(id, quickReaction.defaultReaction, at),
    onSelectionChange: (ids) => {
      setSelectedIds(ids)
      setSelectMode(ids.size > 0)
    },
  })
  // Окно «кто отреагировал»: id, а не снимок сообщения — живые реакции обновляют его на месте.
  const [reactorsFor, setReactorsFor] = useState<{
    chatId: string
    id: string
    emoji?: string
  } | null>(null)
  const reactorsMessage =
    reactorsFor && reactorsFor.chatId === activeId
      ? messages.data?.find((m) => m.id === reactorsFor.id)
      : undefined

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
    reactTo,
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
    reactTo,
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
      react: (id, emoji, origin) => msgHandlersRef.current.reactTo(id, emoji, origin),
      touchStart: (e, m) => msgHandlersRef.current.onMsgTouchStart(e, m),
      touchMove: (e) => msgHandlersRef.current.onMsgTouchMove(e),
      touchEnd: (e) => msgHandlersRef.current.onMsgTouchEnd(e),
      openCalendar: (ymd) => setCalendarDay(ymd),
      showReactors: (m, emoji) => setReactorsFor({ chatId: m.chatId, id: m.id, emoji }),
    }),
    [],
  )

  // Каркас как в Telegram (стек экранов). Телефон: открытая переписка — верхний экран поверх
  // списка: въезжает справа, список отступает влево и темнеет; назад — свайпом от левого края,
  // кнопкой «назад» шапки или системной «назад». На планшете и ПК колонки стоят рядом, стек
  // выключен. Состояние «чат открыт» снимается, когда уход доехал, — до этого уезжает живая
  // переписка, а не пустой экран.
  const chatStack = useScreenStack<HTMLElement>({
    open: !!activeId,
    onClose: () => setActiveId(null),
    enabled: isPhone,
    openKey: activeId,
  })
  const closeChat = chatStack.close
  // Панели колонки (папки, чёрный список, новая группа) — тот же стек внутри колонки: панель
  // ложится поверх списка и уходит вправо по «назад» в своей шапке.
  const panelOpen = foldersOpen || blockedOpen || createGroupOpen || quickReactionOpen
  const panelStackRef = useRef<ScreenStackHandle | null>(null)
  const closePanelsNow = (): void => {
    setFoldersOpen(false)
    setBlockedOpen(false)
    setCreateGroupOpen(false)
    setQuickReactionOpen(false)
  }
  const closePanel = (): void => {
    if (panelStackRef.current) panelStackRef.current.close()
    else closePanelsNow()
  }
  // Статус связи вместо заголовка списка: «Ожидание сети…», «Соединение…», «Обновление…».
  const connectionStatus = useConnectionStatus(connected)
  // ПК: ширина колонки списка тянется за край и запоминается; совсем узкая — одни аватары.
  const listWidth = useChatListWidth(embedded)

  // Горячие клавиши каркаса (как в Telegram Web). Esc снимает верхний слой: меню шапки,
  // панель деталей, режим выбора, поиск по переписке — и только потом саму переписку или
  // панель колонки. Alt+↑/↓ и Ctrl+Tab / Ctrl+Shift+Tab — соседний чат в том порядке, в
  // каком он виден в списке (с учётом выбранной папки). Ctrl/⌘+F — выше, у поиска по чату.
  // Обработчик читает свежее состояние через ref: подписка одна на всё время жизни окна.
  const shellKeysRef = useRef<(e: KeyboardEvent) => void>(() => undefined)
  shellKeysRef.current = (e) => {
    if (e.defaultPrevented || e.isComposing) return
    if (e.key === 'Escape') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      // Открытое окно, диалог подтверждения или меню закрываются сами — это их Esc.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      // Своя выпадашка списка — без роли меню, закрываем сами. Меню шапки — Radix (role=menu),
      // выбор «От кого» живёт в поиске и снимается его ступенчатым Esc.
      if (newChatOpen) {
        setNewChatOpen(false)
        return
      }
      if (detailsOpen) {
        // Экранную панель деталей (не колонку) закрывает её собственный обработчик выше.
        if (isWide) setDetailsOpen(false)
        return
      }
      if (selectMode) {
        exitSelect()
        return
      }
      if (chatSearchOpen) {
        chatSearch.escape()
        return
      }
      if (activeId) {
        // Ответ или правку в поле ввода снимает сам композер, а не закрытие переписки.
        if (editing || replyTo) return
        e.preventDefault()
        closeChat()
        return
      }
      if (panelOpen) {
        e.preventDefault()
        closePanel()
      }
      return
    }
    const altStep =
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    const tabStep = e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey
    if (!altStep && !tabStep) return
    // Порядок — как на экране: строки списка в порядке документа (папка, закреплённые
    // сверху). Список свёрнут или в нём выдача поиска — порядок открытых чатов из данных.
    const rows = [...chatRows.rowElsRef.current.entries()]
      .filter(([, el]) => el.isConnected)
      .sort(([, a], [, b]) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      .map(([id]) => id)
    const ids = rows.length > 0 ? rows : filterChatsByTab(list, undefined).map((c) => c.id)
    if (ids.length === 0) return
    e.preventDefault()
    const dir = altStep ? (e.key === 'ArrowUp' ? -1 : 1) : e.shiftKey ? -1 : 1
    const at = activeId ? ids.indexOf(activeId) : -1
    // Alt упирается в края списка, Ctrl+Tab идёт по кругу — как вкладки.
    const nextIndex =
      at < 0
        ? dir > 0
          ? 0
          : ids.length - 1
        : tabStep
          ? (at + dir + ids.length) % ids.length
          : at + dir
    const next = ids[nextIndex]
    if (next && next !== activeId) setActiveId(next)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => shellKeysRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      quickReaction={quickReaction.defaultReaction}
      onOpenQuickReaction={() => setQuickReactionOpen(true)}
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
      chatsError={chats.isError}
      onRetryChats={() => void chats.refetch()}
      myId={myId}
      locale={locale}
      // Возврат к списку ведёт стек экранов (useScreenStack) — своё «появление» списку не нужно.
      returning={false}
      titleSlot={
        connectionStatus === 'online' ? undefined : (
          <ConnectionStatusTitle status={connectionStatus} />
        )
      }
      swiped={chatRows.swiped}
      swipedFlagRef={chatRows.swipedFlagRef}
      longPressedRef={chatRows.longPressedRef}
      longPressRef={rowLongPressRef}
      rowElsRef={chatRows.rowElsRef}
      onRowTouchStart={chatRows.onRowTouchStart}
      onRowTouchMove={chatRows.onRowTouchMove}
      onRowTouchEnd={chatRows.onRowTouchEnd}
      onCloseSwiped={chatRows.closeRow}
      actionsByChat={actionsByChat}
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
      onMuteFor={(c, minutes) => mute.mutate({ chatId: c.id, muted: true, minutes })}
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

  // Настройка папок (§2) — панель на месте списка чатов, а не окно поверх него: сборка
  // папки идёт по всему списку диалогов, и в окне ей всегда было тесно.
  const foldersPanel = (
    <ChatFoldersPanel
      embedded={embedded}
      hidden={false}
      folders={folderList}
      chats={chats.data ?? []}
      busy={createFolder.isPending || updateFolder.isPending || deleteFolder.isPending}
      editId={foldersEditId}
      onClose={closePanel}
      onCreate={(input) => createFolder.mutate(input)}
      onUpdate={(id, input) => updateFolder.mutate({ id, ...input })}
      onDelete={(id) => {
        const folder = folderList.find((f) => f.id === id)
        if (!folder) return
        void confirm({
          title: t('foldersDeleteConfirm', { name: folder.name }),
          destructive: true,
        }).then((ok) => {
          if (ok) deleteFolder.mutate(id)
        })
      }}
      onReorder={reorderFolders}
    />
  )

  const blockedPanel = <BlockedUsersPanel embedded={embedded} hidden={false} onClose={closePanel} />

  const quickReactionPanel = (
    <QuickReactionPanel
      embedded={embedded}
      hidden={false}
      value={quickReaction.defaultReaction}
      onChange={(emoji) =>
        quickReaction.setDefaultReaction(emoji, {
          onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
        })
      }
      onClose={closePanel}
    />
  )

  const createGroupPanel = (
    <CreateGroupPanel
      embedded={embedded}
      hidden={false}
      onClose={closePanel}
      onCreated={(chatId) => {
        setCreateGroupOpen(false)
        setActiveId(chatId)
      }}
    />
  )

  return (
    <div className="relative -mx-4 -mt-4 -mb-24 flex h-[calc(100%+7rem)] overflow-hidden md:-m-6 md:h-[calc(100%+3rem)]">
      {/* Колонка одна: пока открыт экран папок, чёрного списка или создания группы, он ложится
          поверх списка чатов (стек экранов) — и на телефоне во весь экран, и в сайдбаре десктопа. */}
      {(() => {
        const column = (
          <ScreenStack
            open={panelOpen}
            onClose={closePanelsNow}
            handleRef={panelStackRef}
            backClose
            topClassName={embedded ? 'bg-sidebar' : 'bg-background'}
            className={
              embedded ? 'min-h-0 w-full flex-1 flex-col' : 'w-full flex-col md:w-80 lg:hidden'
            }
            base={chatList}
            top={
              foldersOpen
                ? foldersPanel
                : blockedOpen
                  ? blockedPanel
                  : createGroupOpen
                    ? createGroupPanel
                    : quickReactionOpen
                      ? quickReactionPanel
                      : null
            }
          />
        )
        if (embedded && listSlot) {
          return createPortal(
            <div className="relative flex min-h-0 flex-1 flex-col">
              {listWidth.compact ? (
                <ChatListRail
                  chats={filterChatsByTab(list, undefined)}
                  activeId={activeId}
                  onOpenChat={setActiveId}
                  onExpand={listWidth.expand}
                />
              ) : (
                column
              )}
              <ChatListResizeHandle listWidth={listWidth} />
            </div>,
            listSlot,
          )
        }
        // Телефон: колонка — нижний экран под открытой перепиской (отступает и темнеет).
        return (
          <div
            ref={chatStack.baseRef}
            className="relative isolate flex shrink-0 max-md:w-full lg:hidden"
          >
            {column}
            <div
              ref={chatStack.dimRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-30 bg-overlay opacity-0 md:hidden"
            />
          </div>
        )
      })()}
      {activeId && isPhone && (
        <BackCloseWhileOpen key={chatStack.historyKey} onBack={chatStack.closeFromHistory} />
      )}

      {/* Панель сообщений — на мобильном во весь экран; скрыта, пока чат не выбран.
          Она же зона перетаскивания: файл роняют в переписку целиком, а не точно в поле
          ввода. Счётчик dragDepth — чтобы подсветка не мигала, когда курсор проходит над
          вложенными элементами: dragleave прилетает на каждый из них. */}
      <section
        ref={chatStack.topRef}
        className={cn(
          // isolate — фон переписки (ChatWallpaper, -z-10) остаётся внутри секции.
          'relative isolate min-w-0 flex-1 flex-col',
          // Телефон: переписка — верхний экран стека, лежит поверх списка во всю площадь.
          'max-md:absolute max-md:inset-0 max-md:z-10 max-md:bg-background',
          activeId ? 'flex' : 'hidden md:flex',
        )}
        onDragEnter={(e) => {
          if (!canDropFiles(e)) return
          dragDepth.current += 1
          setDropActive(true)
        }}
        onDragOver={(e) => {
          if (!canDropFiles(e)) return
          // Без preventDefault браузер откроет файл вместо того, чтобы отдать его нам.
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (!canDropFiles(e)) return
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDropActive(false)
        }}
        onDrop={(e) => {
          if (!canDropFiles(e)) return
          e.preventDefault()
          dragDepth.current = 0
          setDropActive(false)
          addFiles(e.dataTransfer.files, dropModeOf(e.target) === 'file')
        }}
      >
        {/* Обои переписки — на всю колонку и неподвижны: при смене чата меняется лента
            поверх них, а не фон. Шапки над ними — сплошные (см. ниже). */}
        <ChatWallpaper />
        {dropActive && <ComposerDropArea />}
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6 duration-(--motion-page) animate-in fade-in zoom-in-95">
            <span className="rounded-full border border-border bg-muted/40 px-4 py-2 text-center text-sm text-muted-foreground">
              {t('selectChatPrompt')}
            </span>
          </div>
        ) : (
          // key={activeId} — контент разговора заново проигрывает анимацию при открытии/смене чата.
          <div
            key={activeId}
            className={cn(
              'flex min-h-0 flex-1 flex-col duration-(--motion-page) animate-in fade-in slide-in-from-right-4',
              // Телефон: экран въезжает целиком (стек), второй сдвиг содержимого внутри лишний.
              'max-md:animate-none',
              // Шапки (обычная, выбора, поиска) лежат сплошной плоскостью над обоями.
              '[&>div>header]:bg-background [&>header]:bg-background',
            )}
          >
            {/* Шапка переписки (Telegram): в режиме выбора её место занимает панель выбора,
                в режиме поиска — строка поиска. Сама шапка остаётся смонтированной. */}
            {selectMode && (
              <ChatHeaderSelection
                count={selectedIds.size}
                ownCount={ownSelectedCount}
                onCancel={exitSelect}
                onCopy={bulkCopy}
                onDelete={bulkDelete}
              />
            )}
            {chatSearchOpen && !selectMode && (
              <ChatHeaderSearch
                search={chatSearch}
                isGroup={activeIsGroup}
                isPhone={isPhone}
                members={membersQuery.data ?? []}
                myId={myId}
                calendar={searchCalendar}
              />
            )}
            <ChatHeader
              chat={activeChat}
              title={activeChat ? chatTitle(activeChat, t) : ''}
              peerOnline={isPrivate && otherOnline}
              hidden={selectMode || chatSearchOpen}
              status={
                // Телефон: пока нет связи, подпись — её статус (заголовка списка не видно).
                isPhone && connectionStatus !== 'online' ? (
                  <ConnectionStatusLine status={connectionStatus} />
                ) : (
                  <ChatHeaderStatus
                    kind={activeChat?.type === 'SAVED' ? 'saved' : isPrivate ? 'private' : 'group'}
                    actionLabel={actionLabel}
                    peerOnline={otherOnline}
                    peerLastSeenAt={peerLastSeenAt}
                    memberCount={activeChat?.memberCount ?? 0}
                    store={presenceStore}
                    myId={myId}
                  />
                )
              }
              menu={
                activeChat && (
                  <ChatHeaderMenu
                    chat={activeChat}
                    title={chatTitle(activeChat, t)}
                    peerId={isPrivate ? otherId : undefined}
                    canReport={canReport}
                    exporting={exportChat.isPending}
                    showSearch={isPhone}
                    onSearch={chatSearch.openSearch}
                    onMute={(minutes) =>
                      mute.mutate({ chatId: activeChat.id, muted: true, minutes })
                    }
                    onUnmute={() => mute.mutate({ chatId: activeChat.id, muted: false })}
                    onSelect={() => {
                      setSelectMode(true)
                      setSelectedIds(new Set())
                    }}
                    onToggleArchive={() =>
                      archive.mutate({ chatId: activeChat.id, archived: !activeChat.archived })
                    }
                    onExport={() => exportChat.mutate('txt')}
                    onToggleBlock={() => {
                      if (otherId) block.mutate({ userId: otherId, blocked: activeChat.blocked })
                    }}
                    onClearHistory={() => clearChat.mutate(activeChat.id)}
                    onDelete={() => deleteChat.mutate(activeChat.id)}
                  />
                )
              }
              onBack={() => closeChat()}
              onOpenDetails={() => setDetailsOpen((v) => !v)}
              onSearch={chatSearch.openSearch}
            />

            {/* Панель аудиоплеера (голосовые и музыка подряд) — под шапкой, как в Telegram. */}
            <AudioPlayerBar
              chatId={activeId}
              messages={messages.data}
              onFocusMessage={focusMessage}
            />

            {/* Закреплённые сообщения (§2 карты) — полоса под шапкой, как в Telegram. */}
            <ChatHeaderPinned
              pinned={pinnedList}
              senderName={senderName}
              onJump={focusMessage}
              onUnpin={(id) => setPin.mutate({ id, pinned: false })}
              viewport={{
                scrollRef: messagesScrollRef,
                virtualizerRef,
                messages: messages.data,
              }}
            />

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
                  {/* Нажатие на дату — календарь переписки (Telegram). */}
                  <button
                    type="button"
                    tabIndex={floatingDayShown && listScrolling ? 0 : -1}
                    aria-label={t('openCalendar', { date: floatingDay })}
                    onClick={() =>
                      floatingDayAt && setCalendarDay(formatYmd(new Date(floatingDayAt)))
                    }
                    className={cn(
                      'rounded-full bg-muted/90 px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-[opacity,background-color] duration-200 hover:bg-muted hover:text-foreground',
                      // Telegram: видна, пока ленту листают, и гаснет через секунду покоя.
                      floatingDayShown && listScrolling
                        ? 'pointer-events-auto opacity-100'
                        : 'opacity-0',
                    )}
                  >
                    {floatingDay}
                  </button>
                </div>
              )}
              <div
                ref={messagesScrollRef}
                onScroll={onMessagesScroll}
                onMouseDown={listGestures.onMouseDown}
                onClickCapture={listGestures.onClickCapture}
                onClick={listGestures.onClick}
                onDoubleClick={listGestures.onDoubleClick}
                onPointerDown={listGestures.onPointerDown}
                className="flex-1 overflow-y-auto p-4"
                // Плавающий композер перекрывает низ ленты — держим под ним пустоту ровно
                // по его высоте, иначе последнее сообщение уезжает под панель.
                style={{ paddingBottom: composerH + 8 }}
              >
                {/* Пока лента едет — пусто. Пузыри-заглушки читались как настоящие
                    сообщения: человек начинал их читать ровно в тот момент, когда они
                    сменялись реальной перепиской. */}
                {messages.isLoading ? null : (
                  <Virtualizer ref={virtualizerRef} scrollRef={messagesScrollRef} shift={shiftMode}>
                    {(messages.data ?? []).map((m, i) => {
                      const mine = m.senderId === myId
                      // Группировка подряд идущих сообщений одного автора: аватар/имя — только у первого в серии.
                      const arr = messages.data ?? []
                      const prevMsg = arr[i - 1]
                      // Серия как в Telegram (lib/message-run): рвётся на паузе > 10 мин, смене
                      // дня, служебном сообщении и разделителе «Непрочитанные».
                      const run = messageRunPosition(arr, i, unreadDividerId)
                      // Пометка дня: перед первым сообщением и при смене календарного дня.
                      const showDay =
                        !prevMsg ||
                        new Date(prevMsg.createdAt).toDateString() !==
                          new Date(m.createdAt).toDateString()
                      // Статус доставки своего сообщения (#51) считаем здесь — единый источник
                      // readWatermark/anyOthersOnline/sendState; в MessageItem уходит примитивом.
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
                          } else if (anyOthersOnline) readState = 'delivered'
                        }
                      }
                      return (
                        <MessageItem
                          key={m.id}
                          m={m}
                          mine={mine}
                          isGroup={activeIsGroup}
                          firstOfRun={run.first}
                          lastOfRun={run.last}
                          runStartId={run.startId}
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
                          views={messageViews.get(m.id)}
                          locale={locale}
                          senderNameText={senderName(m)}
                          senderBadge={!mine && activeIsGroup ? senderBadge(m.senderId) : null}
                          replyToNameText={m.replyTo ? senderName(m.replyTo) : null}
                          forwardedFromNameText={
                            m.forwardedFrom ? senderName(m.forwardedFrom) : null
                          }
                          myId={myId}
                          quickReaction={quickReaction.defaultReaction}
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
              {/* Кнопки справа над панелью ввода (Telegram): «к реакции», «к упоминанию» и
                  «вниз» со счётчиком непрочитанных ниже — ui/message-list-fab. */}
              <MessageListFab
                bottom={composerH + 12}
                showDown={showScrollDown}
                unreadBelow={unreadBelow}
                mentionCount={listAttention.mentionCount}
                reactionCount={listAttention.reactionCount}
                onDown={scrollToBottom}
                onMention={() => {
                  void listAttention.nextMention().then((id) => id && focusMessage(id))
                }}
                onReaction={() => {
                  void listAttention.nextReaction().then((id) => id && focusMessage(id))
                }}
                onReadAllMentions={listAttention.readAllMentions}
                onReadAllReactions={listAttention.readAllReactions}
              />
              {/* Панель ввода. На телефоне — плавающий остров поверх ленты (Telegram-стиль):
                он не прибит к краю, лента прокручивается под ним, а место под последним
                сообщением держит padding по измеренной высоте панели.
                На ПК панель докована: сплошная плашка во всю ширину с верхней границей —
                та же поверхность, что у шапки чата. Парящие острова оставляли между собой
                и по краям просветы, сквозь которые лезла лента: у большого пальца это
                читается как «панель лежит поверх», у курсора — как дырки в интерфейсе. */}
              {/* Нижняя панель поиска — только на телефоне (Telegram): автор, календарь,
                  счётчик и стрелки. На ПК всё это в шапке поиска, а поле ввода остаётся. */}
              {chatSearchOpen && isPhone && (
                <ChatHeaderSearchFooter
                  search={chatSearch}
                  isGroup={activeIsGroup}
                  calendar={searchCalendar}
                />
              )}
              {!activeChat?.requestIncoming && !(chatSearchOpen && isPhone) && (
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
                    // Выбор сообщений: поле ввода прячем, оставляя смонтированным (панель выбора).
                    selectMode && '[&>:not([data-selection-footer])]:hidden',
                  )}
                >
                  {/* Режим выбора: действия внизу, на месте поля ввода (Telegram). Поле
                      остаётся смонтированным — его черновик и вложения не теряются. */}
                  {selectMode && (
                    <ChatSelectionFooter
                      selected={selectedInOrder()}
                      myId={myId}
                      canReport={canReport}
                      onForward={() => setForwardIds(selectedInOrder().map((m) => m.id))}
                      onCopy={bulkCopy}
                      onDelete={bulkDelete}
                      onDone={exitSelect}
                    />
                  )}
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
                    blocked={!!blockedActive}
                    iBlocked={!!activeChat?.blocked}
                    requestPending={requestWaiting}
                    otherId={otherId}
                    onUnblock={() => otherId && block.mutate({ userId: otherId, blocked: true })}
                    text={text}
                    onType={onType}
                    onSend={(o) => send(o)}
                    onSendSilent={(o) => send({ ...o, silent: true })}
                    forward={
                      forward.active
                        ? {
                            draft: forward.active,
                            onToggleSender: forward.toggleSender,
                            onToggleCaptions: forward.toggleCaptions,
                            onChangeRecipient: () => setForwardRepick(true),
                            onCancel: forward.cancel,
                          }
                        : null
                    }
                    onEditLast={() => {
                      const last = lastEditableMessage(messages.data, myId)
                      if (last) startEdit(last)
                      return !!last
                    }}
                    chatId={activeId}
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
                    round={round}
                    recMMSS={recMMSS}
                  />
                </div>
              )}
            </div>
            {/* «печатает…» показываем в шапке (вместо статуса), а не здесь — Telegram-стиль. */}

            {/* §50: непринятый входящий запрос — вместо поля ввода решение адресата.
                Инициатору вместо этого показываем, что его сообщение ещё не принято. */}
            {activeChat?.requestIncoming && (
              // На десктопе — одной строкой: вопрос слева, кнопки справа, py-2 вокруг 44-px
              // ряда, как у поля ввода. Тогда верхняя граница идёт одной линией с плашкой
              // профиля внизу сайдбара. На телефоне вопрос длинный — кнопки под ним.
              <div className="flex flex-col gap-3 border-t border-border p-4 lg:flex-row lg:items-center lg:gap-4 lg:py-2">
                <p className="text-center text-sm text-muted-foreground lg:min-w-0 lg:flex-1 lg:text-left">
                  {t('requestPrompt')}
                </p>
                <div className="flex shrink-0 items-center justify-center gap-2 lg:h-11">
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

      {/* Правая колонка (Telegram-стиль, right-column.tsx): в широком окне встаёт рядом и
          сжимает переписку, в узком выезжает поверх неё. */}
      <RightColumn open={detailsOpen} wide={isWide}>
        {detailsProps && (
          <ChatDetailsPanel
            key={detailsProps.chat.id}
            {...detailsProps}
            variant={isWide ? 'column' : 'fullscreen'}
            open={detailsOpen}
          />
        )}
      </RightColumn>

      {menu && (
        <MessageContextMenu
          message={menu.message}
          mine={menu.message.senderId === myId}
          myId={myId}
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          defaultReaction={quickReaction.defaultReaction}
          actions={{
            onReact: (emoji, origin) => reactTo(menu.message.id, emoji, origin),
            onSetDefaultReaction: (emoji) =>
              quickReaction.setDefaultReaction(emoji, {
                onSuccess: () => toast.success(t('tgReactions.quickSet', { emoji })),
                onError: (e) =>
                  toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
              }),
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
            onReport:
              canReport && !menu.message.systemType && !menu.message.id.startsWith('tmp:')
                ? () => setReportMsg(menu.message)
                : undefined,
            onShowReactors: () =>
              setReactorsFor({ chatId: menu.message.chatId, id: menu.message.id }),
          }}
        />
      )}

      {reactorsFor && reactorsMessage && reactorsMessage.reactions.length > 0 && (
        <ReactionsListModal
          reactions={reactorsMessage.reactions}
          myId={myId}
          initialEmoji={reactorsFor.emoji}
          onClose={() => setReactorsFor(null)}
        />
      )}
      {/* Значок «Ответить» при свайпе сообщения влево (тач). */}
      <MessageListSwipeHint ref={swipeHintRef} />

      {reportMsg && (
        <ReportModal
          targetType="MESSAGE"
          targetId={reportMsg.id}
          preview={reportMsg.content || undefined}
          onClose={() => setReportMsg(null)}
        />
      )}

      {calendarDay && (
        <ChatCalendarModal
          initialDay={calendarDay}
          dayThumbs={dayThumbs}
          onMonthChange={setCalendarMonth}
          onClose={() => setCalendarDay(null)}
          onJump={(ymd) => {
            setCalendarDay(null)
            setJumpDate(ymd)
            void jumpToDate(ymd)
          }}
          onClear={(from, to) => {
            // В вопросе — даты словами («4 сентября 2026 г.»), а не ISO из календаря.
            const long = (ymd: string) =>
              new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
                new Date(`${ymd}T00:00:00`),
              )
            void confirm({
              title:
                from === to
                  ? t('clearDayConfirm', { day: long(from) })
                  : t('clearPeriodConfirm', { from: long(from), to: long(to) }),
              destructive: true,
            }).then((ok) => {
              if (!ok) return
              setCalendarDay(null)
              clearPeriod.mutate({ from, to })
            })
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
          onPick={(chatId) => pickForwardTarget(chatId, [forwardMsg])}
          onSubmit={(targetChatIds, caption) =>
            sendForward(targetChatIds, [forwardMsg.id], caption)
          }
          onClose={() => setForwardMsg(null)}
        />
      )}

      {/* «Сменить получателя» у плашки пересылки: та же пересылка уходит в другой чат. */}
      {forwardRepick && forward.draft && (
        <ForwardDialog
          chats={list}
          currentChatId={activeId}
          titleOf={(c) => chatTitle(c, t)}
          tabs={forwardTabs}
          onResolveSaved={resolveSavedChatId}
          onPick={(chatId) => {
            const draft = forward.draft
            if (!draft) return
            const target = list.find((c) => c.id === chatId)
            // В «Избранное» — сразу, как и первый выбор; плашка при этом своё отработала.
            if (!target || target.type === 'SAVED') forward.cancel()
            pickForwardTarget(chatId, draft.messages, { retarget: true })
          }}
          onSubmit={(targetChatIds, caption) => {
            const draft = forward.draft
            if (!draft) return
            forward.cancel()
            void sendForward(
              targetChatIds,
              draft.messages.map((m) => m.id),
              caption,
            )
          }}
          onClose={() => setForwardRepick(false)}
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
          onPick={(chatId) =>
            pickForwardTarget(
              chatId,
              (messages.data ?? []).filter((m) => forwardIds.includes(m.id)),
            )
          }
          onSubmit={(targetChatIds, caption) => sendForward(targetChatIds, forwardIds, caption)}
          onClose={() => {
            setForwardIds(null)
            exitSelect()
          }}
        />
      )}

      {pollCreatorOpen && (
        <PollCreator
          onClose={() => setPollCreatorOpen(false)}
          onCreate={(input) => createPoll.mutate(input)}
          pending={createPoll.isPending}
        />
      )}

      {attachOpen && (
        <AttachmentDialog
          files={attachFiles}
          initialAsFiles={attachAsFiles}
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
          onReorder={(from, to) =>
            setAttachFiles((prev) => {
              const next = [...prev]
              const [moved] = next.splice(from, 1)
              if (moved) next.splice(to, 0, moved)
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

// Идентификаторы сущностей — uuid и токены сида: буквы, цифры, дефис и подчёркивание.
function safeParamId(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null
}
