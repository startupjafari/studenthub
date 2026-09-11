'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  Ban,
  BarChart3,
  BellOff,
  Camera,
  ChevronUp,
  Clock,
  FileText,
  ImageIcon,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Reply,
  Send,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import {
  VoiceWaveform,
  type ChatMemberInfo,
  type ChatMessage,
  type VoiceRecorderController,
} from '../../../entities/chat'
import {
  Avatar,
  AvatarFallback,
  EmojiPicker,
  MARKDOWN_ACTIONS_INLINE,
  RichTextField,
  type RichTextHandle,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { plainPreview } from '../lib/format'
import { useMediaQuery } from '../../../shared/lib'

// Сколько курсор может быть «мимо» до закрытия поповера. Ноль означал бы, что панель
// захлопывается на любом дрожании руки по дороге к ней; полсекунды — что она висит уже
// после того, как человек ушёл. 180 мс — привычный запас из десктопных меню.
const HOVER_CLOSE_MS = 180

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
function useHoverMenu(): {
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
        setByHover(true)
        setOpen(true)
      },
      onPointerLeave: (e) => {
        if (e.pointerType !== 'mouse' || !byHover) return
        clear()
        timer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
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
  // «Без звука»: залипающий переключатель у кнопки отправки.
  silent: boolean
  onToggleSilent: () => void
  // «Отправить позже»: открывает выбор времени (отложенное сообщение).
  onScheduleSend: () => void
  // Личная блокировка активна: вместо поля ввода — баннер (нельзя писать).
  blocked: boolean
  // Я заблокировал собеседника (можно разблокировать) vs он меня.
  iBlocked: boolean
  otherId: string | undefined
  onUnblock: () => void
  text: string
  onType: (v: string) => void
  onSend: () => void
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
  recMMSS: string
}

export function ChatComposer({
  editing,
  onCancelEdit,
  replyTo,
  replyToName,
  replyQuote,
  onCancelReply,
  silent,
  onToggleSilent,
  onScheduleSend,
  blocked,
  iBlocked,
  otherId,
  onUnblock,
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
  recMMSS,
}: ChatComposerProps) {
  const t = useTranslations('Chats')
  const attachMenu = useHoverMenu()
  const sendMenu = useHoverMenu()
  const emoji = useHoverMenu()
  // Отдельные input'ы под фото/видео и съёмку: у них свои accept/capture, а общий (файл
  // любого типа) приходит из родителя. Все три ведут в один onFilesPicked.
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  // Съёмка есть только там, где есть камера под пальцем: на десктопе capture игнорируется
  // и пункт открывал бы тот же диалог файлов — лишний ряд в меню.
  const canCapture = useMediaQuery('(pointer: coarse)')

  // Вставка emoji из пикера (§12) в позицию курсора поля ввода.
  function insertEmoji(emoji: string): void {
    composerRef.current?.insertText(emoji)
  }

  // Плавающий остров панели: полупрозрачный материал, граница и тень (уровень 3).
  // На ПК тени нет: панель там лежит в сплошной плашке и ни над чем не парит, а тень
  // означает ровно «парит над страницей» (§5.2).
  const island = 'material-island border border-border/60 shadow-lg lg:shadow-none'
  // Одна геометрия у всех круглых кнопок ряда — заливка и только она отличает отправку от
  // остальных: раньше каждая кнопка перечисляла свои классы заново, и любая правка
  // расходилась по трём местам.
  //
  // Размера два: 56 px под палец и 40 px под курсор. 56 — правило плавающих островов у
  // нижнего края (§4): панель ввода стоит там в одном ряду с нижней навигацией и обязана
  // совпадать с ней по высоте. На десктопе нижней навигации нет вовсе — панель остаётся у
  // края одна, равняться ей не на что, и тот же остров читается просто как огромный.
  // 40 px — обычный размер контрола (`lg` шкалы) и та же высота, что у иконочных кнопок
  // шапки чата: на десктопе панель ввода встаёт с ними в один рост.
  const ROUND = 'flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[color,background-color,transform] active:scale-95 disabled:cursor-default disabled:opacity-50 lg:size-10 lg:rounded-md' // prettier-ignore
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
    <div className="pointer-events-auto flex flex-col gap-2">
      {/* Панель правки (Telegram-стиль): иконка · вертикальная полоса-акцент · заголовок
          акцентным цветом и однострочное превью · крестик. Полоса — та же метка «это про
          вон то сообщение», что у цитаты в пузыре; без неё панель читалась как обычная
          подсказка над полем. Превью — без markdown: звёздочки и обратные кавычки в
          однострочной справке не значат ничего, а строку засоряют. */}
      {editing && (
        <div className={cn(island, 'flex items-center gap-2 rounded-2xl px-3 py-2 lg:rounded-md')}>
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

      {/* Панель ответа — тот же строй, что у правки. */}
      {replyTo && !editing && (
        <div className={cn(island, 'flex items-center gap-2 rounded-2xl px-3 py-2 lg:rounded-md')}>
          <Reply className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="h-8 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-primary">
              {replyQuote
                ? t('quotingFrom', { name: replyToName })
                : t('replyingTo', { name: replyToName })}
            </span>
            <p
              className={cn(
                'truncate text-xs text-muted-foreground',
                // Курсив отличает выделенный фрагмент от превью всего сообщения: полосу
                // для этого больше не занимаем — она теперь общая метка панели.
                replyQuote && 'italic',
              )}
            >
              {plainPreview(replyQuote || replyTo.content) || t('attachment')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelReply}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {blocked ? (
        <div
          className={cn(
            island,
            'flex items-center justify-center gap-2 rounded-2xl p-4 text-center text-sm text-muted-foreground lg:rounded-md',
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
      ) : (
        // items-end, а не items-center: поле растёт вверх под многострочный текст, а
        // круглые кнопки остаются внизу, на своей линии.
        <div className="relative flex items-end gap-2">
          {/* Попап @-упоминаний участников */}
          {mentionCandidates.length > 0 && !voice.recording && (
            <div className="absolute bottom-full left-3 z-20 mb-1 max-h-56 w-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
              {mentionCandidates.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onInsertMention(u)}
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
          {voice.recording ? (
            // Строка записи: отмена · таймер + волны · пауза/продолжить · отправить
            <>
              <button
                type="button"
                aria-label={t('cancelRecording')}
                onClick={voice.cancel}
                className={cn(roundBtn, 'text-destructive hover:text-destructive')}
              >
                <Trash2 className="size-6 lg:size-5" aria-hidden />
              </button>
              <div
                className={cn(
                  island,
                  'flex h-14 min-w-0 flex-1 items-center gap-2 rounded-full px-4 lg:h-10 lg:rounded-md',
                )}
              >
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
                <button
                  type="button"
                  aria-label={voice.paused ? t('resumeRecording') : t('pauseRecording')}
                  onClick={voice.paused ? voice.resume : voice.pause}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground lg:size-7"
                >
                  {voice.paused ? (
                    <Play className="size-4" aria-hidden />
                  ) : (
                    <Pause className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              <button
                type="button"
                aria-label={t('send')}
                onClick={voice.finish}
                className={sendBtn}
              >
                <Send className="size-6 lg:size-5" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <div
                ref={attachMenu.ref}
                className="relative shrink-0"
                // Выключенная кнопка не открывается и наведением: обработчики висят на
                // обёртке, а она про `disabled` кнопки внутри ничего не знает.
                {...(connected && !editing ? attachMenu.hoverProps : {})}
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
                {/* Attachment-меню (§37): Фото/видео · Камера · Файл · Опрос. Фото отдельным
                    пунктом, а не «файлом», — иначе галерея открывается на всех документах.
                    Раскрывается наведением, как смайлы и опции отправки: три соседние
                    кнопки одного ряда не могут вести себя по-разному. Отступ — padding
                    контейнера, а не margin меню: иначе на пути курсора мёртвая зона. */}
                {attachMenu.open && (
                  <div className="absolute bottom-full left-0 z-50 pb-2">
                    <div className="w-48 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 slide-in-from-bottom-1">
                      {(
                        [
                          {
                            key: 'photo',
                            icon: ImageIcon,
                            label: t('attachPhoto'),
                            run: () => mediaInputRef.current?.click(),
                          },
                          {
                            key: 'camera',
                            icon: Camera,
                            label: t('attachCamera'),
                            run: () => cameraInputRef.current?.click(),
                            hidden: !canCapture,
                          },
                          {
                            key: 'file',
                            icon: FileText,
                            label: t('attachFile'),
                            run: () => fileInputRef.current?.click(),
                          },
                          {
                            key: 'poll',
                            icon: BarChart3,
                            label: t('createPoll'),
                            run: () => onCreatePoll?.(),
                            hidden: !onCreatePoll,
                          },
                        ] as const
                      )
                        .filter((a) => !('hidden' in a && a.hidden))
                        .map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            onClick={() => {
                              attachMenu.close()
                              a.run()
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                          >
                            <a.icon className="size-4 shrink-0 opacity-80" aria-hidden />
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
                  'relative flex min-h-14 min-w-0 flex-1 items-center rounded-3xl transition-[border-color] focus-within:border-ring/70 lg:min-h-10 lg:rounded-md',
                )}
              >
                <RichTextField
                  bare
                  handle={composerRef}
                  value={text}
                  onChange={onType}
                  actions={MARKDOWN_ACTIONS_INLINE}
                  wrapperClassName="min-w-0 flex-1"
                  className="max-h-32 overflow-y-auto py-3 pl-4 pr-1 lg:py-2 lg:pl-3.5"
                  aria-label={t('messagePlaceholder')}
                  placeholder={t('messagePlaceholder')}
                  onKeyDown={(e) => {
                    // Открыт попап упоминаний: Enter — выбрать первого, Escape — закрыть.
                    if (mentionCandidates.length > 0) {
                      if (e.key === 'Enter') {
                        const first = mentionCandidates[0]
                        if (first) onInsertMention(first)
                        return true
                      }
                      if (e.key === 'Escape') {
                        onCloseMentions()
                        return true
                      }
                    }
                    // Enter отправляет, Shift+Enter — перенос строки (это делает редактор).
                    if (e.key === 'Enter' && !e.shiftKey) {
                      onSend()
                      return true
                    }
                    return false
                  }}
                />
                {/* Emoji-пикер (§12): вставка в позицию курсора; попап остаётся открытым для
                    нескольких. Раскрывается наведением — смайл выбирают глазами, и клик
                    «чтобы посмотреть» тут лишний шаг. Кнопка живёт внутри капсулы поля
                    (референс Telegram), поэтому её диаметр — высота капсулы минус её же
                    скругление: круг во все 56 px вылез бы за кромку. Иконка и отклик на
                    нажатие — те же, что у круглых кнопок ряда. */}
                <div
                  ref={emoji.ref}
                  className="relative shrink-0 self-end p-1"
                  {...(connected ? emoji.hoverProps : {})}
                >
                  <button
                    type="button"
                    aria-label={t('emoji')}
                    aria-expanded={emoji.open}
                    disabled={!connected}
                    onClick={emoji.toggle}
                    className="flex size-12 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] hover:bg-foreground/[0.06] hover:text-foreground active:scale-95 disabled:cursor-default disabled:opacity-50 lg:size-8 lg:rounded-md"
                  >
                    <Smile className="size-6 lg:size-5" aria-hidden />
                  </button>
                  {emoji.open && (
                    // Отступ — внутренним padding, а не margin: между кнопкой и панелью
                    // не должно быть мёртвой зоны, иначе курсор до панели не доходит.
                    <div className="absolute bottom-full right-0 z-50 pb-2">
                      <EmojiPicker
                        size="lg"
                        searchPlaceholder={t('emojiSearch')}
                        onPick={insertEmoji}
                      />
                    </div>
                  )}
                </div>
              </div>
              {showSend ? (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={silent ? t('sendSilentAria') : t('send')}
                    disabled={!connected}
                    onClick={onSend}
                    // Правый клик и долгое нажатие — дополнительные способы отправки,
                    // как в Telegram. Обычный клик остаётся обычной отправкой.
                    onContextMenu={(e) => {
                      e.preventDefault()
                      sendMenu.toggle()
                    }}
                    className={sendBtn}
                  >
                    {silent ? (
                      <BellOff className="size-6 lg:size-5" aria-hidden />
                    ) : (
                      <Send className="size-6 lg:size-5" aria-hidden />
                    )}
                  </button>
                  {/* Опции отправки («без звука», «позже») — своя зона наведения, а не вся
                      кнопка: иначе меню выскакивало бы каждый раз, когда курсор идёт к
                      «Отправить». Шеврон подрос с 16 до 24 px — в прежний попадали через
                      раз, а по §13 цель нажатия не бывает меньше 24. */}
                  <div
                    ref={sendMenu.ref}
                    className="absolute -top-1 -right-1"
                    {...sendMenu.hoverProps}
                  >
                    <button
                      type="button"
                      aria-label={t('sendOptions')}
                      aria-expanded={sendMenu.open}
                      onClick={sendMenu.toggle}
                      className="flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:size-5"
                    >
                      <ChevronUp className="size-4 lg:size-3.5" aria-hidden />
                    </button>
                    {sendMenu.open && (
                      // right-1 гасит вынос самого шеврона за кнопку: правый край меню
                      // встаёт вровень с «Отправить», а не на 4px за ним.
                      // Отступ — padding контейнера, а не margin меню: между шевроном и
                      // меню не должно быть мёртвой зоны, иначе курсор до него не дойдёт.
                      <div className="absolute bottom-full right-1 z-50 pb-2">
                        <div className="w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95">
                          <button
                            type="button"
                            onClick={() => {
                              onToggleSilent()
                              sendMenu.close()
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                          >
                            <BellOff className="size-4 shrink-0 opacity-80" aria-hidden />
                            {silent ? t('sendSilentOff') : t('sendSilentOn')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onScheduleSend()
                              sendMenu.close()
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                          >
                            <Clock className="size-4 shrink-0 opacity-80" aria-hidden />
                            {t('sendLater')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={t('recordVoice')}
                  disabled={!connected}
                  onClick={() => void voice.start()}
                  className={roundBtn}
                >
                  <Mic className="size-6 lg:size-5" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
