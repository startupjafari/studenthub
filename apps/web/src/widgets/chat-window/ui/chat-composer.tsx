'use client'

import { useRef, useState, type RefObject } from 'react'
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
import { useMediaQuery } from '../../../shared/lib'

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
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
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
  const island = 'material-island border border-border/60 shadow-lg'
  // Круглая кнопка-остров (скрепка, микрофон, отмена записи) — 48 px под палец.
  const roundBtn = cn(
    island,
    'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-[color,transform] hover:text-foreground active:scale-95 disabled:cursor-default disabled:opacity-50',
  )

  return (
    // Не одна панель, а несколько островов в колонке: ответ/правка сверху, ниже ряд
    // «скрепка · поле · микрофон». Отступ до края экрана держит обёртка в ChatWindow;
    // pointer-events-auto — обёртка их снимает, чтобы лента прокручивалась рядом с панелью.
    <div className="pointer-events-auto flex flex-col gap-2">
      {/* Панель правки */}
      {editing && (
        <div className={cn(island, 'flex items-center gap-2 rounded-2xl px-3 py-2 text-xs')}>
          <Pencil className="size-3.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{t('editing')}</span>
            <p className="line-clamp-1 text-muted-foreground">{editing.content}</p>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelEdit}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Панель ответа */}
      {replyTo && !editing && (
        <div className={cn(island, 'flex items-center gap-2 rounded-2xl px-3 py-2 text-xs')}>
          <Reply className="size-3.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">
              {replyQuote
                ? t('quotingFrom', { name: replyToName })
                : t('replyingTo', { name: replyToName })}
            </span>
            <p
              className={cn(
                'line-clamp-1 text-muted-foreground',
                // Цитату отбиваем полосой, чтобы её было видно как чужой текст, а не как
                // превью оригинала.
                replyQuote && 'border-l-2 border-primary/50 pl-2 italic',
              )}
            >
              {replyQuote || replyTo.content || t('attachment')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={onCancelReply}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {blocked ? (
        <div
          className={cn(
            island,
            'flex items-center justify-center gap-2 rounded-2xl p-4 text-center text-sm text-muted-foreground',
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
                <Trash2 className="size-5" aria-hidden />
              </button>
              <div
                className={cn(
                  island,
                  'flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full px-4',
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
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
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
                className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
              >
                <Send className="size-5" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('attach')}
                  aria-expanded={attachMenuOpen}
                  disabled={!connected || !!editing}
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  className={roundBtn}
                >
                  <Paperclip className="size-5" aria-hidden />
                </button>
                {/* Attachment-меню (§37): Фото/видео · Камера · Файл · Опрос. Фото отдельным
                    пунктом, а не «файлом», — иначе галерея открывается на всех документах. */}
                {attachMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAttachMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 z-50 mb-2 w-48 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 slide-in-from-bottom-1">
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
                              setAttachMenuOpen(false)
                              a.run()
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                          >
                            <a.icon className="size-4 shrink-0 opacity-80" aria-hidden />
                            {a.label}
                          </button>
                        ))}
                    </div>
                  </>
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
                  'relative flex min-w-0 flex-1 items-end rounded-3xl transition-[border-color] focus-within:border-ring/70',
                )}
              >
                <RichTextField
                  bare
                  handle={composerRef}
                  value={text}
                  onChange={onType}
                  actions={MARKDOWN_ACTIONS_INLINE}
                  wrapperClassName="min-w-0 flex-1"
                  className="max-h-32 overflow-y-auto py-3 pl-4 pr-1"
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
                {/* Emoji-пикер (§12): вставка в позицию курсора; попап остаётся открытым для нескольких. */}
                <div className="relative shrink-0 pb-1 pr-1">
                  <button
                    type="button"
                    aria-label={t('emoji')}
                    disabled={!connected}
                    onClick={() => setEmojiOpen((v) => !v)}
                    className="flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-50"
                  >
                    <Smile className="size-5" aria-hidden />
                  </button>
                  {emojiOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setEmojiOpen(false)} />
                      <div className="absolute bottom-full right-0 z-50 mb-2">
                        <EmojiPicker searchPlaceholder={t('emojiSearch')} onPick={insertEmoji} />
                      </div>
                    </>
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
                      setSendMenuOpen(true)
                    }}
                    className="flex size-12 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:cursor-default disabled:opacity-50"
                  >
                    {silent ? (
                      <BellOff className="size-5" aria-hidden />
                    ) : (
                      <Send className="size-5" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t('sendOptions')}
                    aria-expanded={sendMenuOpen}
                    onClick={() => setSendMenuOpen((v) => !v)}
                    className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronUp className="size-3" aria-hidden />
                  </button>
                  {sendMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setSendMenuOpen(false)} />
                      <div className="absolute bottom-full right-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95">
                        <button
                          type="button"
                          onClick={() => {
                            onToggleSilent()
                            setSendMenuOpen(false)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                        >
                          <BellOff className="size-4 shrink-0 opacity-80" aria-hidden />
                          {silent ? t('sendSilentOff') : t('sendSilentOn')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onScheduleSend()
                            setSendMenuOpen(false)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                        >
                          <Clock className="size-4 shrink-0 opacity-80" aria-hidden />
                          {t('sendLater')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={t('recordVoice')}
                  disabled={!connected}
                  onClick={() => void voice.start()}
                  className={roundBtn}
                >
                  <Mic className="size-5" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
