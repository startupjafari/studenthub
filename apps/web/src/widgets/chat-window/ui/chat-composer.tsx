'use client'

import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Ban,
  BarChart3,
  BellOff,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronUp,
  Clock,
  FileText,
  ImageIcon,
  ListChecks,
  Lock,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Eye,
  Reply,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import type { ChatChecklistCreateInput, ChatPermissions } from '@studenthub/shared-schemas'
import {
  VoiceWaveform,
  composerKeys,
  fetchScheduledMessages,
  scheduleMessageRequest,
  sendChecklistRequest,
  type ChatMemberInfo,
  type ChatMessage,
  type RoundVideoRecorderController,
  type VoiceRecorderController,
} from '../../../entities/chat'
import {
  MARKDOWN_ACTIONS_INLINE,
  RichTextField,
  RowContextMenu,
  type RichTextHandle,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { plainPreview } from '../lib/format'
import { useMediaQuery } from '../../../shared/lib'
import { useRealtimeEvent } from '../../../shared/realtime'
import { useComposerVoiceHold } from '../lib/composer-voice-hold'
import { ComposerMainButton, type MainButtonMode, type RecordKind } from './composer-main-button'
import { ComposerRoundPreview } from './composer-round-preview'
import { ReplyThumb, replyThumbOf } from './message-reply-quote'
import { ComposerMentionList } from './composer-mention-list'
import { ComposerSymbolMenu, useSymbolMenuPresence } from './composer-symbol-menu'
import { ComposerScheduleDialog } from './composer-schedule-dialog'
import { ComposerScheduledPanel } from './composer-scheduled-panel'
import { ComposerChecklistCreator } from './composer-checklist-creator'
import { ComposerLinkPreview } from './composer-link-preview'
import { ComposerEmojiTooltip } from './composer-emoji-tooltip'
import { ComposerForwardBar } from './composer-forward-bar'
import { useDraftLinkPreview } from '../lib/use-draft-link-preview'
import { useEmojiSuggestions } from '../lib/use-emoji-suggestions'
import type { ForwardDraft } from '../lib/use-forward-draft'

/** Что поле ввода решило про отправку сверх текста: превью ссылки закрыли крестиком. */
export interface ComposerSendOptions {
  noLinkPreview?: boolean
}

/** Пересылка, собранная над полем этого чата (см. useForwardDraft). */
export interface ComposerForward {
  draft: ForwardDraft
  onToggleSender: () => void
  onToggleCaptions: () => void
  onChangeRecipient: () => void
  onCancel: () => void
}

// Сколько курсор может быть «мимо» до закрытия поповера. Ноль означал бы, что панель
// захлопывается на любом дрожании руки по дороге к ней; полсекунды — что она висит уже
// после того, как человек ушёл. 180 мс — привычный запас из десктопных меню.
const HOVER_CLOSE_MS = 180

/** Ключ браузерного хранилища: что пишет кнопка записи — голосовое или кружок. */
const RECORD_KIND_KEY = 'chat.recordKind'

/**
 * Поповер панели ввода, который раскрывается наведением, а не нажатием: смайлы и опции
 * отправки смотрят, а не выбирают вслепую, и лишний клик на пути только мешает.
 *
 * Три вещи, без которых наведение работает хуже нажатия:
 *  · Закрытие с задержкой. Между кнопкой и панелью курсор идёт по диагонали и успевает
 *    выйти за оба элемента — мгновенное закрытие делает панель недостижимой.
 *  · Только мышь. На тач-экране наведения нет вовсе, на пере оно случайно; там остаётся
 *    нажатие, и закрывает панель тоже жест, а не увод курсора.
 *  · Клавиатура не забыта: кнопка остаётся кнопкой, Enter открывает, Escape закрывает.
 *
 * Панель, открытую жестом, гасит нажатие мимо — слушателем на документе, а не невидимым
 * слоем поверх экрана: капсула поля ввода несёт `backdrop-filter`, а он делает её
 * containing block для `position: fixed`, и такой слой накрыл бы саму капсулу вместо окна.
 */
function useHoverMenu({
  openDelayMs = 0,
  closeDelayMs = HOVER_CLOSE_MS,
}: { openDelayMs?: number; closeDelayMs?: number } = {}): {
  open: boolean
  /** Ref обёртки «кнопка + панель»: по нему отличаем нажатие внутри от нажатия мимо. */
  ref: RefObject<HTMLDivElement | null>
  hoverProps: {
    onPointerEnter: (e: React.PointerEvent) => void
    onPointerLeave: (e: React.PointerEvent) => void
  }
  toggle: () => void
  close: () => void
} {
  const [open, setOpen] = useState(false)
  const [byHover, setByHover] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => clear, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        clear()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Нажатие мимо закрывает только панель, открытую жестом: у наведения эту роль играет
  // увод курсора, и гасить её ещё и по клику значило бы закрывать смайлы на каждый выбор.
  useEffect(() => {
    if (!open || byHover) return
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        clear()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, byHover])

  return {
    open,
    ref,
    hoverProps: {
      onPointerEnter: (e) => {
        if (e.pointerType !== 'mouse') return
        clear()
        // Уже открытую панель курсор просто «держит»; закрытую — открывает, с задержкой,
        // если она задана: курсор, пролетевший над кнопкой по пути, панель не дёргает.
        if (open) {
          setByHover(true)
          return
        }
        const show = (): void => {
          setByHover(true)
          setOpen(true)
        }
        if (openDelayMs > 0) timer.current = setTimeout(show, openDelayMs)
        else show()
      },
      onPointerLeave: (e) => {
        if (e.pointerType !== 'mouse') return
        clear()
        if (!open || !byHover) return
        timer.current = setTimeout(() => setOpen(false), closeDelayMs)
      },
    },
    toggle: () => {
      clear()
      setByHover(false)
      setOpen((v) => !v)
    },
    close: () => {
      clear()
      setOpen(false)
    },
  }
}

// Composer (Telegram-стиль §29, §37): панель правки/ответа, @-упоминания, вложения,
// запись голосового и поле ввода. Презентационный лист — состояние и мутации живут в родителе.
export type ChatComposerProps = {
  editing: ChatMessage | null
  onCancelEdit: () => void
  replyTo: ChatMessage | null
  replyToName: string
  // Процитированный фрагмент отвечаемого сообщения (Telegram-стиль): показываем именно его,
  // а не начало оригинала — человек выделил конкретное место.
  replyQuote: string | null
  onCancelReply: () => void
  /** «Просмотр сообщения» из меню полосы ответа (§5 карты): перемотать ленту к оригиналу. */
  onViewReplyTarget: () => void
  // «Без звука»: залипающий переключатель у кнопки отправки.
  // «Отправить позже»: открывает выбор времени (отложенное сообщение).
  // Личная блокировка активна: вместо поля ввода — баннер (нельзя писать).
  blocked: boolean
  // Я заблокировал собеседника (можно разблокировать) vs он меня.
  iBlocked: boolean
  otherId: string | undefined
  onUnblock: () => void
  // Мой запрос на переписку отправлен и ещё не принят: вместо поля ввода — плашка в строе
  // баннера блокировки. Дописывать, пока собеседник не ответил, нечего.
  requestPending: boolean
  text: string
  onType: (v: string) => void
  onSend: (opts?: ComposerSendOptions) => void
  showSend: boolean
  connected: boolean
  // Не ссылка на DOM-поле: поле форматированного текста отдаёт наружу свои операции
  // (фокус, вставка текста, текст до курсора) — упоминаниям и emoji нужны они.
  composerRef: RefObject<RichTextHandle | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  onFilesPicked: (files: FileList | null) => void
  // Создать опрос (§38, attachment-меню). undefined — пункт не показываем (напр. в личных чатах).
  onCreatePoll?: () => void
  mentionCandidates: ChatMemberInfo[]
  onInsertMention: (u: ChatMemberInfo) => void
  onCloseMentions: () => void
  myId: string | undefined
  voice: VoiceRecorderController
  /**
   * Запись кружка (видеосообщения). Есть — короткое нажатие на микрофон переключает его на
   * камеру и обратно, как в Telegram; нет — кнопка пишет только голосовое.
   */
  round?: RoundVideoRecorderController
  recMMSS: string
  /**
   * Открытый чат: по нему поле ввода само шлёт чек-листы и ставит отложенные. Нет чата —
   * этих действий нет.
   */
  chatId?: string | null
  /** «Отправить без звука» из меню кнопки отправки. Нет обработчика — пункта нет. */
  onSendSilent?: (opts?: ComposerSendOptions) => void
  /** Пересылка в этот чат ждёт отправки: плашка над полем вместо ответа. */
  forward?: ComposerForward | null
  /**
   * ↑ в пустом поле — правка последнего своего сообщения (Telegram). `true` — нашлось и
   * правка началась; `false` — стрелка остаётся стрелкой.
   */
  onEditLast?: () => boolean
  /**
   * Права рядового участника группы (§8.3, «Разрешения»). null — ограничений нет (не группа,
   * админ или владелец). Без права писать — плашка вместо поля; запрещённые пункты скрепки
   * и голосовые прячутся. Сервер проверяет то же самое сам.
   */
  restrictions?: ChatPermissions | null
}

export function ChatComposer({
  editing,
  onCancelEdit,
  replyTo,
  replyToName,
  replyQuote,
  onCancelReply,
  onViewReplyTarget,
  blocked,
  iBlocked,
  otherId,
  onUnblock,
  requestPending,
  text,
  onType,
  onSend,
  showSend,
  connected,
  composerRef,
  fileInputRef,
  onFilesPicked,
  onCreatePoll,
  mentionCandidates,
  onInsertMention,
  onCloseMentions,
  myId,
  voice,
  round,
  recMMSS,
  chatId = null,
  onSendSilent,
  onEditLast,
  forward = null,
  restrictions = null,
}: ChatComposerProps) {
  const canMedia = restrictions?.sendMedia !== false
  const canPolls = restrictions?.sendPolls !== false
  const t = useTranslations('Chats')
  const locale = useLocale()
  // Меню полосы ответа: точка вызова, а не флаг — меню строится вокруг курсора.
  const [replyMenu, setReplyMenu] = useState<{ x: number; y: number } | null>(null)
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const attachMenu = useHoverMenu()
  // Тайминги панели символов — как у Telegram Web: открытие через 200 мс наведения
  // (ResponsiveHoverButton), закрытие через 250 мс после ухода курсора (useMouseInside).
  const emoji = useHoverMenu({ openDelayMs: 200, closeDelayMs: 250 })
  const emojiPresence = useSymbolMenuPresence(emoji.open)
  // Меню кнопки «Отправить» (без звука · позже): точка вызова, а не флаг.
  const [sendMenu, setSendMenu] = useState<{ x: number; y: number } | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduledOpen, setScheduledOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  // Выбранная строка подсказки упоминаний. Привязана к составу списка: сменился список
  // (дописали букву) — выбор снова на первой строке, без эффекта со сбросом.
  const mentionKey = mentionCandidates.map((u) => u.id).join(',')
  const [mentionPick, setMentionPick] = useState({ key: '', index: 0 })
  const mentionIndex = mentionPick.key === mentionKey ? mentionPick.index : 0
  const setMentionIndex = (index: number): void => setMentionPick({ key: mentionKey, index })
  const mentionListId = useId()
  const emojiTipId = useId()
  // Превью ссылки до отправки (П.5) и подсказка эмодзи по слову (П.31) — как в Telegram.
  const linkPreview = useDraftLinkPreview(text, connected && !blocked && !requestPending)
  const emojiTip = useEmojiSuggestions(locale, composerRef)
  const sendOpts = (): ComposerSendOptions =>
    linkPreview.noLinkPreview ? { noLinkPreview: true } : {}
  const submit = (): void => onSend(sendOpts())
  // Что пишет кнопка записи: голосовое или кружок. Последний выбор помним в браузере — как в
  // Telegram, где кнопка остаётся камерой, если ей пользовались последней.
  // Читаем после монтирования: на сервере хранилища нет, и разметка разошлась бы с клиентской.
  const [recordKind, setRecordKind] = useState<RecordKind>('voice')
  useEffect(() => {
    try {
      if (window.localStorage.getItem(RECORD_KIND_KEY) === 'video') setRecordKind('video')
    } catch {
      // Хранилище закрыто (приватное окно) — остаётся голосовое.
    }
  }, [])
  const kind: RecordKind = round ? recordKind : 'voice'
  // Идущая запись держит свой рекордер, что бы ни было выбрано: переключение посреди записи
  // не должно терять её.
  const recorder: VoiceRecorderController =
    round && (round.recording || (kind === 'video' && !voice.recording)) ? round : voice
  const recordingRound = !!round && recorder === round
  const toggleRecordKind = (): void => {
    if (!round || voice.recording || round.recording) {
      toast(t('tgComposer.voiceHoldHint'))
      return
    }
    const next: RecordKind = kind === 'video' ? 'voice' : 'video'
    setRecordKind(next)
    try {
      window.localStorage.setItem(RECORD_KIND_KEY, next)
    } catch {
      // Хранилище закрыто (приватное окно) — выбор живёт до перезагрузки, и только.
    }
    // Подсказка жеста — одна на экране: id заменяет прошлую, а не копит стопку.
    toast(t(next === 'video' ? 'tgMessage.holdToRecordRound' : 'tgComposer.voiceHoldHint'), {
      id: 'composer-record-kind',
    })
  }
  const hold = useComposerVoiceHold(recorder, { onTap: toggleRecordKind })
  // Таймер строки записи — по идущему рекордеру: у кружка свой счётчик секунд.
  const recLabel = recordingRound
    ? `${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')}`
    : recMMSS
  // Наведение открывает меню только на ПК. На узком экране (в том числе в узком окне
  // браузера с мышью) панель смайлов доковано под полем ввода и занимает пол-экрана:
  // раскрывать её проездом курсора — то же самое, что открывать клавиатуру наведением.
  const hoverOpens = useMediaQuery('(min-width: 1024px) and (hover: hover)')
  // Отдельные input'ы под фото/видео и съёмку: у них свои accept/capture, а общий (файл
  // любого типа) приходит из родителя. Все три ведут в один onFilesPicked.
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  // Съёмка есть только там, где есть камера под пальцем: на десктопе capture игнорируется
  // и пункт открывал бы тот же диалог файлов — лишний ряд в меню.
  const canCapture = useMediaQuery('(pointer: coarse)')

  // Выбрали «Ответить» (меню, свайп, кнопка) — курсор сразу в поле, как в Telegram: ответ
  // пишут тут же, без лишнего клика по полю. Два кадра ожидания: меню сообщения при
  // закрытии возвращает фокус на свою кнопку, и наш фокус должен прийти после него.
  const replyId = replyTo?.id
  const replyThumb = replyTo ? replyThumbOf(replyTo.media) : null
  useEffect(() => {
    if (!replyId) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => composerRef.current?.focus())
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [replyId, composerRef])

  // Вставка emoji из пикера (§12) в позицию курсора поля ввода.
  function insertEmoji(emoji: string): void {
    composerRef.current?.insertText(emoji)
  }
  // ⌫ панели эмодзи (Telegram): стирает знак перед курсором — графему целиком.
  function backspace(): void {
    composerRef.current?.deleteBackward()
  }

  const onApiError = (e: unknown): void => {
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  }
  // Чек-лист уходит REST-запросом и приезжает в ленту событием message:new — оптимистичного
  // пузыря у него нет, как и у опроса. Ответ, если он был, на него и уходит.
  const replyFields = (): { replyToId?: string } => (replyTo ? { replyToId: replyTo.id } : {})
  const afterRichSend = (): void => {
    if (replyTo) onCancelReply()
  }
  const sendChecklist = useMutation({
    mutationFn: (
      input: Pick<ChatChecklistCreateInput, 'title' | 'items' | 'othersCanAdd' | 'othersCanMark'>,
    ) => sendChecklistRequest(chatId as string, { ...input, ...replyFields() }),
    onSuccess: () => {
      setChecklistOpen(false)
      afterRichSend()
    },
    onError: onApiError,
  })

  // Отложенные этого чата: значок часов в поле ввода виден, пока они есть (Telegram).
  // Список меняется и с других устройств — сервер шлёт об этом событие только автору.
  const scheduled = useQuery({
    queryKey: composerKeys.scheduled(chatId ?? ''),
    queryFn: () => fetchScheduledMessages(chatId as string),
    enabled: !!chatId,
  })
  useRealtimeEvent<{ chatId: string }>('chat:scheduled-changed', (p) => {
    void qc.invalidateQueries({ queryKey: composerKeys.scheduled(p.chatId) })
  })
  const scheduledCount = scheduled.data?.length ?? 0
  const schedule = useMutation({
    mutationFn: (scheduledAt: string) =>
      scheduleMessageRequest(chatId as string, {
        content: text.trim(),
        ...replyFields(),
        ...(replyTo && replyQuote ? { replyQuote } : {}),
        scheduledAt,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: composerKeys.scheduled(chatId ?? '') })
      setScheduleOpen(false)
      onType('')
      afterRichSend()
      toast.success(t('tgComposer.scheduleDone'))
    },
    onError: onApiError,
  })

  /** Перехват клавиш поля ввода. `true` — клавиша обработана, редактору её не отдаём. */
  function onFieldKey(e: KeyboardEvent): boolean {
    // Открыта подсказка упоминаний: стрелки ходят по ней, Enter/Tab выбирают, Esc закрывает.
    if (mentionCandidates.length > 0) {
      const n = mentionCandidates.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setMentionIndex((mentionIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const picked = mentionCandidates[Math.min(mentionIndex, n - 1)]
        if (picked) onInsertMention(picked)
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseMentions()
        return true
      }
    }
    // Подсказка эмодзи: по `:запросу` стрелки и Enter — её, по слову — только Tab и Esc.
    if (mentionCandidates.length === 0 && emojiTip.onKey(e)) return true
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
    // ↑ в пустом поле — править последнее своё (Telegram).
    // Текст правки приходит в поле следующим рендером — курсор ставим в конец уже после него.
    if (e.key === 'ArrowUp' && plain && !editing && !text.trim() && onEditLast?.()) {
      requestAnimationFrame(() => composerRef.current?.focus())
      return true
    }
    // Esc снимает правку, затем ответ — но не раньше, чем закроется открытая панель символов.
    if (e.key === 'Escape' && !emoji.open && !attachMenu.open) {
      if (editing) {
        onCancelEdit()
        return true
      }
      if (replyTo) {
        onCancelReply()
        return true
      }
      if (forward) {
        forward.onCancel()
        return true
      }
    }
    // Enter отправляет, Shift+Enter — перенос строки (это делает редактор).
    if (e.key === 'Enter' && !e.shiftKey) {
      submit()
      return true
    }
    return false
  }

  // Главная кнопка: запись голосового (удержанием или кликом), отправка, подтверждение правки.
  // Пока запись зафиксирована (замок или клик мышью), кнопка отправляет голосовое.
  const voiceLocked = recorder.recording && !hold.holding
  // Голосовое — медиа: без права на медиа (§8.3) микрофона нет, кнопка остаётся отправкой.
  const mainMode: MainButtonMode = voiceLocked
    ? 'send'
    : editing
      ? 'edit'
      : // Пересылка уходит и без текста — кнопка сразу «отправить», а не микрофон.
        showSend || forward || !canMedia
        ? 'send'
        : 'record'

  // Плавающий остров панели: полупрозрачный материал, граница и тень (уровень 3).
  // На ПК тени нет: панель там лежит в сплошной плашке и ни над чем не парит, а тень
  // означает ровно «парит над страницей» (§5.2).
  const island = 'material-island border border-border/60 shadow-lg lg:shadow-none'
  // Одна геометрия у всех круглых кнопок ряда — заливка и только она отличает отправку от
  // остальных: раньше каждая кнопка перечисляла свои классы заново, и любая правка
  // расходилась по трём местам.
  //
  // Размера два: 48 px под палец и 44 px под курсор.
  //
  // 48, а не 56 из правила плавающих островов (DESIGN_SYSTEM §4). Правило держит одну
  // высоту у островов, которые видны одновременно, — а нижняя навигация в открытом чате
  // скрыта (`hideBottomNav` в app-shell), и совпадать панели ввода не с чем. Зато она
  // соседствует с телеграмным эталоном в голове у человека: там скрепка, поле и кнопка
  // записи ровно такие, и 56 рядом с ними читались как непомерные.
  // 44 px — на ступень выше обычного контрола (`lg` шкалы, 40): поле ввода — главный
  // контрол экрана, и в 40 px оно выглядело тесным. Ряд вместе с отступами плашки даёт ту
  // же высоту, что у плашки профиля внизу сайдбара (см. ChatWindow).
  const ROUND = 'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[color,background-color,transform] active:scale-95 disabled:cursor-default disabled:opacity-50 lg:size-11 lg:rounded-md' // prettier-ignore
  const roundBtn = cn(
    island,
    ROUND,
    // В плашке у кнопки своей обводки нет — рамка внутри рамки. Форму на ПК ей задаёт
    // подложка на наведении, как пункту меню или кнопке шапки.
    'text-muted-foreground hover:text-foreground lg:border-transparent lg:hover:bg-muted',
  )
  const sendBtn = cn(ROUND, 'bg-primary text-primary-foreground shadow-lg lg:shadow-none')

  return (
    // Не одна панель, а несколько островов в колонке: ответ/правка сверху, ниже ряд
    // «скрепка · поле · микрофон». Отступ до края экрана держит обёртка в ChatWindow;
    // pointer-events-auto — обёртка их снимает, чтобы лента прокручивалась рядом с панелью.
    <div
      className="pointer-events-auto relative flex flex-col gap-2"
      // Ctrl+V со скриншотом — основной способ отправить картинку в мессенджере, и раньше
      // он не работал вовсе: вставка уходила в редактор как текст (то есть в никуда).
      // Слушаем на обёртке, а не внутри RichTextField: событие всплывает из
      // contenteditable, а перехват здесь не трогает редактор и работает, даже когда
      // курсор стоит в другом контроле панели.
      onPaste={(e) => {
        if (!connected || editing) return
        const files = e.clipboardData?.files
        if (!files || files.length === 0) return
        // Есть файлы — текстовую часть буфера не вставляем: пользователь копировал снимок.
        e.preventDefault()
        onFilesPicked(files)
      }}
    >
      {/* Кружок пишется — над полем ввода круглое превью камеры с кольцом длины (Telegram). */}
      {recordingRound && round?.stream && (
        <ComposerRoundPreview stream={round.stream} seconds={round.seconds} />
      )}

      {/* Панель правки (Telegram-стиль): иконка · вертикальная полоса-акцент · заголовок
          акцентным цветом и однострочное превью · крестик. Полоса — та же метка «это про
          вон то сообщение», что у цитаты в пузыре; без неё панель читалась как обычная
          подсказка над полем. Превью — без markdown: звёздочки и обратные кавычки в
          однострочной справке не значат ничего, а строку засоряют. */}
      {/* Превью ссылки до отправки (Telegram WebPagePreview) — над плашками ответа и правки:
          оно про текст в поле, а они про то, к чему этот текст относится. */}
      {linkPreview.preview && !voice.recording && (
        <ComposerLinkPreview
          className={island}
          preview={linkPreview.preview}
          onDismiss={linkPreview.dismiss}
        />
      )}
      {editing && (
        <div
          className={cn(
            island,
            'flex items-center gap-2 rounded-2xl px-3 py-2 duration-200 animate-in fade-in slide-in-from-bottom-2 lg:rounded-md',
          )}
        >
          <Pencil className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="h-8 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-primary">{t('editing')}</span>
            <p className="truncate text-xs text-muted-foreground">
              {plainPreview(editing.content) || t('attachment')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelEdit}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Панель ответа — тот же строй, что у правки. Правый клик даёт то же, что в Telegram:
          посмотреть оригинал и отвязать цитату (§5 карты). */}
      {replyTo && !editing && (
        <div
          className={cn(
            island,
            'flex items-center gap-2 rounded-2xl px-3 py-2 duration-200 animate-in fade-in slide-in-from-bottom-2 lg:rounded-md',
          )}
          onContextMenu={(e) => {
            e.preventDefault()
            const box = e.currentTarget.getBoundingClientRect()
            const keyboard = e.clientX === 0 && e.clientY === 0
            setReplyMenu({
              x: keyboard ? box.left + 24 : e.clientX,
              y: keyboard ? box.top : e.clientY,
            })
          }}
        >
          <Reply className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="h-8 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
          {/* Миниатюра снимка или ролика оригинала — как в плашке ответа Telegram. */}
          {replyThumb && <ReplyThumb media={replyThumb} className="size-8" />}
          {/* Нажатие по плашке ведёт к оригиналу в ленте — как в Telegram. */}
          <button
            type="button"
            onClick={onViewReplyTarget}
            title={t('goToMessage')}
            className="min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="block text-xs font-medium text-primary">
              {replyQuote
                ? t('quotingFrom', { name: replyToName })
                : t('replyingTo', { name: replyToName })}
            </span>
            <span
              className={cn(
                'block truncate text-xs text-muted-foreground',
                // Курсив отличает выделенный фрагмент от превью всего сообщения: полосу
                // для этого больше не занимаем — она теперь общая метка панели.
                replyQuote && 'italic',
              )}
            >
              {plainPreview(replyQuote || replyTo.content) ||
                (replyThumb?.videoNote ? t('tgMessage.replyRound') : t('attachment'))}
            </span>
          </button>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelReply}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
          {replyMenu && (
            <RowContextMenu
              x={replyMenu.x}
              y={replyMenu.y}
              ariaLabel={t('replyingTo', { name: replyToName })}
              onClose={() => setReplyMenu(null)}
              items={[
                {
                  key: 'view',
                  icon: Eye,
                  label: t('goToMessage'),
                  onClick: onViewReplyTarget,
                },
                {
                  key: 'remove',
                  icon: X,
                  label: t('cancelReply'),
                  onClick: onCancelReply,
                  danger: true,
                },
              ]}
            />
          )}
        </div>
      )}

      {/* Пересылка в этот чат ждёт отправки: дописанный текст уйдёт комментарием перед ней. */}
      {forward && !editing && !replyTo && (
        <ComposerForwardBar
          className={island}
          draft={forward.draft}
          onToggleSender={forward.onToggleSender}
          onToggleCaptions={forward.onToggleCaptions}
          onChangeRecipient={forward.onChangeRecipient}
          onCancel={forward.onCancel}
        />
      )}

      {blocked ? (
        <div
          className={cn(
            island,
            'flex items-center justify-center gap-2 rounded-2xl p-4 text-center text-sm text-muted-foreground lg:h-11 lg:rounded-md lg:py-0',
          )}
        >
          <Ban className="size-4 shrink-0" aria-hidden />
          <span>{iBlocked ? t('blockedBanner') : t('blockedByBanner')}</span>
          {iBlocked && otherId && (
            <button
              type="button"
              onClick={onUnblock}
              className="font-medium text-primary hover:underline"
            >
              {t('unblockUser')}
            </button>
          )}
        </div>
      ) : restrictions?.sendMessages === false ? (
        // Админ группы запретил участникам писать (§8.3) — как в Telegram, плашка вместо поля.
        <div
          className={cn(
            island,
            'flex items-center justify-center gap-2 rounded-2xl p-4 text-center text-sm text-muted-foreground lg:h-11 lg:rounded-md lg:py-0',
          )}
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <span>{t('tgGroups.restricted')}</span>
        </div>
      ) : requestPending ? (
        <div
          className={cn(
            island,
            'flex items-center justify-center gap-2 rounded-2xl p-4 text-center text-sm text-muted-foreground lg:h-11 lg:rounded-md lg:py-0',
          )}
        >
          <Clock className="size-4 shrink-0" aria-hidden />
          <span>{t('requestPending')}</span>
        </div>
      ) : (
        // items-end, а не items-center: поле растёт вверх под многострочный текст, а
        // круглые кнопки остаются внизу, на своей линии.
        <div className="relative flex items-end gap-2">
          {/* Подсказка @-упоминаний: ↑/↓ — выбор, Enter/Tab — вставить, Esc — закрыть. */}
          {mentionCandidates.length > 0 && !recorder.recording && (
            <ComposerMentionList
              id={mentionListId}
              candidates={mentionCandidates}
              activeIndex={Math.min(mentionIndex, mentionCandidates.length - 1)}
              myId={myId}
              onPick={onInsertMention}
              onHover={setMentionIndex}
            />
          )}
          {emojiTip.suggestions && mentionCandidates.length === 0 && !voice.recording && (
            <ComposerEmojiTooltip
              id={emojiTipId}
              items={emojiTip.suggestions.items}
              activeIndex={Math.min(emojiTip.activeIndex, emojiTip.suggestions.items.length - 1)}
              showActive={emojiTip.suggestions.mode === 'colon'}
              onPick={emojiTip.pick}
              onHover={emojiTip.setActiveIndex}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onFilesPicked(e.target.files)
              e.target.value = ''
            }}
          />
          {/* Фото/видео и съёмка — отдельные input'ы: accept открывает галерею сразу на
              медиа, а capture — камеру, минуя выбор файла. */}
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              onFilesPicked(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              onFilesPicked(e.target.files)
              e.target.value = ''
            }}
          />
          {hold.holding ? (
            // Запись удержанием (телефон): таймер и подсказка «влево — отмена», над кнопкой —
            // замок. Палец ведёт кнопку; положение пишет хук прямо в transform.
            <div
              className={cn(
                island,
                'relative flex h-12 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full px-4 lg:h-11 lg:rounded-md',
              )}
            >
              <span
                className="size-2 shrink-0 animate-pulse rounded-full bg-destructive"
                aria-hidden
              />
              <span className="w-10 shrink-0 tabular-nums text-sm text-muted-foreground">
                {recLabel}
              </span>
              <div
                ref={hold.hintRef}
                className="flex min-w-0 flex-1 items-center justify-center gap-1 text-sm text-muted-foreground"
              >
                <ChevronLeft className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t('tgComposer.voiceSlideToCancel')}</span>
              </div>
            </div>
          ) : recorder.recording ? (
            // Зафиксированная запись: отмена · таймер + волны · пауза/продолжить. Отправка —
            // главной кнопкой справа (она же была микрофоном). У кружка строка та же.
            <>
              <button
                type="button"
                aria-label={t('cancelRecording')}
                onClick={recorder.cancel}
                className={cn(roundBtn, 'text-destructive hover:text-destructive')}
              >
                <Trash2 className="size-6 lg:size-5" aria-hidden />
              </button>
              <div
                className={cn(
                  island,
                  'flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full px-4 lg:h-11 lg:rounded-md',
                )}
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full bg-destructive',
                    !recorder.paused && 'animate-pulse',
                  )}
                  aria-hidden
                />
                <span className="w-10 shrink-0 tabular-nums text-sm text-muted-foreground">
                  {recLabel}
                </span>
                <VoiceWaveform analyserRef={recorder.analyserRef} paused={recorder.paused} />
                <button
                  type="button"
                  aria-label={recorder.paused ? t('resumeRecording') : t('pauseRecording')}
                  onClick={recorder.paused ? recorder.resume : recorder.pause}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground lg:size-7"
                >
                  {recorder.paused ? (
                    <Play className="size-4" aria-hidden />
                  ) : (
                    <Pause className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                ref={attachMenu.ref}
                // Без медиа и опросов (§8.3) в скрепке нечего выбрать — её нет совсем.
                hidden={!canMedia && !canPolls}
                className="relative shrink-0"
                // Выключенная кнопка не открывается и наведением: обработчики висят на
                // обёртке, а она про `disabled` кнопки внутри ничего не знает.
                {...(connected && !editing && hoverOpens ? attachMenu.hoverProps : {})}
              >
                <button
                  type="button"
                  aria-label={t('attach')}
                  aria-expanded={attachMenu.open}
                  disabled={!connected || !!editing}
                  onClick={attachMenu.toggle}
                  className={roundBtn}
                >
                  <Paperclip className="size-6 lg:size-5" aria-hidden />
                </button>
                {/* Attachment-меню (§37, Telegram AttachMenu): Фото или видео · Камера · Файл ·
                    Опрос · Чек-лист. Фото отдельным пунктом, а не «файлом», — иначе галерея
                    открывается на всех документах. Раскрывается наведением, как смайлы:
                    соседние кнопки одного ряда не могут вести себя по-разному. Отступ —
                    padding контейнера, а не margin меню: иначе на пути курсора мёртвая зона. */}
                {attachMenu.open && (
                  <div className="absolute bottom-full left-0 z-50 pb-2">
                    <div
                      role="menu"
                      aria-label={t('attach')}
                      className="w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-(--motion-menu) animate-in fade-in zoom-in-95 slide-in-from-bottom-1"
                    >
                      {(
                        [
                          {
                            key: 'photo',
                            icon: ImageIcon,
                            label: t('attachPhoto'),
                            run: () => mediaInputRef.current?.click(),
                            hidden: !canMedia,
                          },
                          {
                            key: 'camera',
                            icon: Camera,
                            label: t('attachCamera'),
                            run: () => cameraInputRef.current?.click(),
                            hidden: !canCapture || !canMedia,
                          },
                          {
                            key: 'file',
                            icon: FileText,
                            label: t('attachFile'),
                            run: () => fileInputRef.current?.click(),
                            hidden: !canMedia,
                          },
                          {
                            key: 'poll',
                            icon: BarChart3,
                            label: t('createPoll'),
                            run: () => onCreatePoll?.(),
                            hidden: !onCreatePoll || !canPolls,
                          },
                          {
                            key: 'checklist',
                            icon: ListChecks,
                            label: t('tgComposer.attachChecklist'),
                            run: () => setChecklistOpen(true),
                            hidden: !chatId || !canPolls,
                          },
                        ] as const
                      )
                        .filter((a) => !('hidden' in a && a.hidden))
                        .map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              attachMenu.close()
                              a.run()
                            }}
                            // Строка выше и значок крупнее, чем в обычном меню: сюда
                            // целятся пальцем на телефоне, а пунктов всего четыре-пять —
                            // место на них есть.
                            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                          >
                            <a.icon className="size-5 shrink-0 opacity-80" aria-hidden />
                            {a.label}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Поле и смайл — одна капсула (референс Telegram): текст растёт внутрь
                  острова, смайл живёт у правого края поля, а не отдельной кнопкой в ряду.
                  Само поле — то же RichTextField, что у поста и статьи: жирный виден жирным
                  сразу, на сервер уезжает markdown, панель всплывает над выделением. Enter
                  отправляет, Shift+Enter переносит строку, с пятой строки поле прокручивается. */}
              <div
                className={cn(
                  island,
                  'relative flex min-h-12 min-w-0 flex-1 items-center rounded-3xl transition-[border-color] focus-within:border-ring/70 lg:min-h-11 lg:rounded-md',
                )}
              >
                <RichTextField
                  bare
                  handle={composerRef}
                  value={text}
                  onChange={(v) => {
                    onType(v)
                    emojiTip.update()
                  }}
                  actions={MARKDOWN_ACTIONS_INLINE}
                  wrapperClassName="min-w-0 flex-1"
                  className="max-h-32 overflow-y-auto py-2.5 pl-4 pr-1 lg:py-2 lg:pl-3.5"
                  aria-label={t('messagePlaceholder')}
                  placeholder={t('messagePlaceholder')}
                  onKeyDown={onFieldKey}
                />
                {/* Отложенные этого чата (Telegram: значок календаря в поле) — только пока
                    они есть. Открывает список: отправить сейчас или отменить. */}
                {scheduledCount > 0 && (
                  <div className="shrink-0 self-end p-1 pr-0">
                    <button
                      type="button"
                      aria-label={t('tgComposer.scheduledOpen', { count: scheduledCount })}
                      title={t('tgComposer.scheduledOpen', { count: scheduledCount })}
                      onClick={() => setScheduledOpen(true)}
                      className="flex size-10 cursor-pointer items-center justify-center rounded-full text-primary outline-none hover:bg-foreground/[0.06] focus-visible:ring-4 focus-visible:ring-ring/20 lg:size-8 lg:rounded-md"
                    >
                      <CalendarClock className="size-6 lg:size-5" aria-hidden />
                    </button>
                  </div>
                )}
                {/* Панель эмодзи (Telegram SymbolMenu). Эмодзи встают в позицию курсора, и
                    панель остаётся открытой для нескольких. Раскрывается наведением — смайл
                    выбирают глазами, и клик «чтобы посмотреть» тут лишний шаг. Кнопка живёт внутри
                    капсулы поля, поэтому её диаметр — высота капсулы минус скругление. */}
                <div
                  ref={emoji.ref}
                  className="relative shrink-0 self-end p-1"
                  {...(connected && hoverOpens ? emoji.hoverProps : {})}
                >
                  <button
                    type="button"
                    aria-label={t('emoji')}
                    aria-expanded={emoji.open}
                    disabled={!connected}
                    onClick={emoji.toggle}
                    className="flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] hover:bg-foreground/[0.06] hover:text-foreground active:scale-95 disabled:cursor-default disabled:opacity-50 lg:size-8 lg:rounded-md"
                  >
                    <Smile className="size-6 lg:size-5" aria-hidden />
                  </button>
                  {emojiPresence.mounted && (
                    // На ПК — всплывающая панель у кнопки: курсор приходит к ней сверху, и
                    // место под окном есть. Отступ — внутренним padding, а не margin: между
                    // кнопкой и панелью не должно быть мёртвой зоны, иначе курсор до панели
                    // не доходит. На телефоне вместо неё панель под полем (ниже). Появление
                    // и уход — как пузырь меню Telegram: из угла у кнопки, с масштаба 0,85.
                    <div
                      className={cn(
                        'absolute bottom-full right-0 z-50 hidden origin-bottom-right pb-3 lg:block',
                        emojiPresence.closing
                          ? 'pointer-events-none duration-(--motion-exit) fill-mode-forwards animate-out fade-out-0 zoom-out-85'
                          : 'duration-(--motion-menu) animate-in fade-in-0 zoom-in-85',
                      )}
                    >
                      <ComposerSymbolMenu
                        variant="popover"
                        onEmoji={insertEmoji}
                        onBackspace={backspace}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {/* Главная кнопка — один и тот же элемент во всех состояниях ряда: значок меняется
              анимацией, а не подменой узла, и палец, держащий запись, не теряет цель. */}
          <div className="relative shrink-0">
            {hold.holding && (
              <div
                ref={hold.lockRef}
                aria-hidden
                className="pointer-events-none absolute bottom-full left-1/2 mb-8 flex -translate-x-1/2 flex-col items-center gap-0.5 rounded-full border border-border bg-popover px-2 py-2 text-muted-foreground shadow-lg duration-(--motion-menu) animate-in fade-in-0 slide-in-from-bottom-2"
              >
                <Lock className="size-4" />
                <ChevronUp className="size-4 motion-safe:animate-bounce" />
              </div>
            )}
            <ComposerMainButton
              buttonRef={hold.buttonRef}
              mode={mainMode}
              recordKind={kind}
              onToggleRecordKind={round ? toggleRecordKind : undefined}
              holding={hold.holding}
              ariaLabel={
                mainMode === 'record'
                  ? kind === 'video'
                    ? t('tgMessage.recordRound')
                    : t('recordVoice')
                  : mainMode === 'edit'
                    ? t('tgComposer.saveEdit')
                    : t('send')
              }
              disabled={!connected && !voiceLocked}
              className={mainMode === 'record' && !hold.holding ? roundBtn : sendBtn}
              onClick={() => {
                if (voiceLocked) recorder.finish()
                else if (mainMode === 'record') void recorder.start()
                else submit()
              }}
              onMenu={
                // Пересылка уходит пачкой: «без звука» и «позже» у неё нет.
                mainMode === 'send' && !voiceLocked && !editing && !forward
                  ? (x, y) => setSendMenu({ x, y })
                  : undefined
              }
              onRecordPointerDown={hold.onPointerDown}
            />
          </div>
          {sendMenu && (
            <RowContextMenu
              x={sendMenu.x}
              y={sendMenu.y}
              ariaLabel={t('sendOptions')}
              onClose={() => setSendMenu(null)}
              items={[
                ...(onSendSilent
                  ? [
                      {
                        key: 'silent',
                        icon: BellOff,
                        label: t('tgComposer.sendSilent'),
                        onClick: () => onSendSilent(sendOpts()),
                      },
                    ]
                  : []),
                ...(chatId
                  ? [
                      {
                        key: 'schedule',
                        icon: CalendarClock,
                        label: t('tgComposer.sendLater'),
                        onClick: () => setScheduleOpen(true),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      )}

      {/* Панель эмодзи на телефоне — ПОД полем ввода, на месте клавиатуры, как в Telegram.
          Всплывающее окно у кнопки здесь не работает: оно шириной в половину экрана, висит
          над полем и закрывает собой последние сообщения — то есть ровно то, к чему смайл
          и подбирают. Панель уезжает вниз вместе с полем и занимает всю ширину. */}
      {emoji.open && !recorder.recording && (
        // Во всю ширину экрана: отрицательные поля гасят отступы плавающего острова, а
        // скругления и рамка остаются только сверху — панель встаёт на место клавиатуры и
        // с трёх сторон уходит за кромку, как в Telegram.
        <div className="-mx-3 -mb-[max(0.5rem,calc(0.5rem+env(safe-area-inset-bottom)-var(--kb-inset,0px)))] overflow-hidden rounded-t-2xl border-t border-border bg-popover duration-200 animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:hidden">
          <ComposerSymbolMenu variant="dock" onEmoji={insertEmoji} onBackspace={backspace} />
        </div>
      )}

      {scheduleOpen && chatId && (
        <ComposerScheduleDialog
          preview={text.trim()}
          pending={schedule.isPending}
          onClose={() => setScheduleOpen(false)}
          onConfirm={(at) => schedule.mutate(at)}
        />
      )}
      {scheduledOpen && chatId && (
        <ComposerScheduledPanel chatId={chatId} onClose={() => setScheduledOpen(false)} />
      )}
      {checklistOpen && chatId && (
        <ComposerChecklistCreator
          pending={sendChecklist.isPending}
          onClose={() => setChecklistOpen(false)}
          onCreate={(input) => sendChecklist.mutate(input)}
        />
      )}
    </div>
  )
}
