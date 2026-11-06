'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Pause,
  Play,
  Reply,
  Send,
  Smile,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react'
import { CHAT_REACTION_EMOJIS } from '@studenthub/shared-config'
import {
  replySupportRequest,
  type SupportMessage,
  type SupportReplyPreview,
} from '../../../entities/support-ticket'
import {
  ALBUM_MAX_ITEMS,
  AttachmentDialog,
  MessageAttachments,
  MessageContent,
  ReactionBar,
  VoiceWaveform,
  compressImages,
  convertUnsupportedImages,
  sendMessageWithAttachments,
  sendMessageWithDirectUpload,
  useVoiceRecorder,
  type AttachmentSendOptions,
  type MessageMenuAnchor,
} from '../../../entities/chat'
import { needsDirectUpload } from '../../../shared/api'
import {
  Button,
  captureAnchor,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmojiPicker,
  Textarea,
} from '../../../shared/ui'
import {
  cn,
  formatBytes,
  isOversizeOnPick,
  maxUploadBytes,
  toApiError,
  useByteUnitLabel,
} from '../../../shared/lib'

/**
 * Сообщение обращения — пузырь чата: автор слева, команда справа, цитата ответа, вложения,
 * реакции и время. Действия (реакция, ответ) — у пузыря при наведении, на тач-экране всегда.
 */
export function SupportBubble({
  message: m,
  fromAuthor,
  firstOfRun,
  myId,
  onReply,
  onReact,
  onJumpTo,
  onOpenMenu,
  time,
}: {
  message: SupportMessage
  fromAuthor: boolean
  firstOfRun: boolean
  myId: string | undefined
  onReply: () => void
  onReact: (emoji: string) => void
  onJumpTo: (messageId: string) => void
  /** Правый клик (на телефоне — долгое нажатие): меню сообщения, как в чате. */
  onOpenMenu: (x: number, y: number, anchor?: MessageMenuAnchor) => void
  time: string
}) {
  const t = useTranslations('SupportDesk')
  const tChat = useTranslations('Chats')
  const senderName = `${m.sender.lastName} ${m.sender.firstName}`
  const reply = m.replyTo

  return (
    <div
      id={`support-msg-${m.id}`}
      className={cn(
        'group flex items-center gap-1 rounded-xl transition-colors data-[flash=true]:bg-primary/10',
        fromAuthor ? 'self-start' : 'flex-row-reverse self-end',
        'max-w-[85%]',
        firstOfRun && 'mt-1.5 first:mt-0',
      )}
      onContextMenu={(e) => {
        e.preventDefault()
        // Долгое нажатие на тач-экране приходит тем же событием: меню тогда вырастает из
        // самого пузыря, как в чате. Мышью — у точки клика.
        const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
        onOpenMenu(e.clientX, e.clientY, touch ? captureAnchor(e.currentTarget) : undefined)
      }}
    >
      <div
        className={cn('flex min-w-0 flex-col gap-0.5', fromAuthor ? 'items-start' : 'items-end')}
      >
        {firstOfRun && (
          <span className="px-1 text-xs font-medium text-muted-foreground">{senderName}</span>
        )}
        <div
          className={cn(
            'flex min-w-0 flex-col gap-1 rounded-2xl px-3 py-1.5 text-sm',
            fromAuthor ? 'bg-muted' : 'bg-primary/15',
          )}
        >
          {reply && <ReplyQuote reply={reply} onClick={() => onJumpTo(reply.id)} />}
          {/* Вложения — тем же видом, что в чате: обращение и есть чат, а сотрудник в нём
              участник, так что ссылки на файлы выдаёт обычная проверка членства. */}
          {m.media && m.media.length > 0 && (
            <MessageAttachments
              media={m.media}
              // Пузыри здесь светлые, а не сплошные синие, как свои в чате: подписи
              // вложений нужны обычного цвета.
              mine={false}
              viewerMeta={{
                senderName,
                createdAt: m.createdAt,
                mine: !fromAuthor,
                caption: m.content ?? undefined,
              }}
            />
          )}
          {m.content && (
            <div className="break-words">
              <MessageContent content={m.content} />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ReactionBar reactions={m.reactions ?? []} myId={myId} onToggle={onReact} />
            <time dateTime={m.createdAt} className="text-[11px] tabular-nums text-muted-foreground">
              {time}
            </time>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('react')}
              title={t('react')}
              className="size-7 text-muted-foreground"
            >
              <SmilePlus className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={fromAuthor ? 'start' : 'end'} className="flex gap-0.5 p-1">
            {CHAT_REACTION_EMOJIS.map((emoji) => (
              <DropdownMenuItem
                key={emoji}
                className="justify-center px-1.5 text-lg"
                onSelect={() => onReact(emoji)}
              >
                {emoji}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={tChat('reply')}
          title={tChat('reply')}
          className="size-7 text-muted-foreground"
          onClick={onReply}
        >
          <Reply className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/** Цитата сообщения, на которое ответили: полоска слева и одна строка, как в чате. */
function ReplyQuote({ reply, onClick }: { reply: SupportReplyPreview; onClick: () => void }) {
  const t = useTranslations('SupportDesk')
  const deleted = !!reply.deletedAt
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deleted}
      className="flex min-w-0 flex-col rounded-md border-l-2 border-primary bg-primary/10 px-2 py-1 text-left text-xs"
    >
      <span className="truncate font-semibold">
        {reply.sender.lastName} {reply.sender.firstName}
      </span>
      <span className={cn('truncate', deleted && 'italic opacity-80')}>
        {deleted ? t('replyDeleted') : reply.content || t('noText')}
      </span>
    </button>
  )
}

interface SendVars {
  content: string
  files: File[]
  spoilered?: File[]
  asFiles?: boolean
}

/** Файл не влез в свой лимит даже после сжатия — сообщаем имя и сам лимит. */
class OversizeError extends Error {
  constructor(readonly file: File) {
    super('oversize')
  }
}

/**
 * Ответ как в чате: смайлы, вложения (через диалог отправки чата), голосовое и ответ на
 * сообщение. Обычный текст уходит ручкой поддержки (`/support/:id/reply`, с записью в аудит),
 * всё остальное — чатовой отправкой: сотрудник участник обращения, а правила обращения
 * (переоткрытие, первый ответ) сервер применяет к любому сообщению в нём.
 */
export function SupportComposer({
  ticketId,
  closedTicket,
  replyTo,
  onCancelReply,
  onSent,
}: {
  ticketId: string
  closedTicket: boolean
  replyTo: SupportMessage | null
  onCancelReply: () => void
  onSent: () => void
}) {
  const t = useTranslations('SupportDesk')
  const tChat = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const unitLabel = useByteUnitLabel()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Ответ выбран — сразу в поле: «Ответить» нажимают, чтобы писать.
  useEffect(() => {
    if (replyTo) textRef.current?.focus()
  }, [replyTo])

  // Смайлы закрывает нажатие мимо панели и Escape.
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: PointerEvent): void => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setEmojiOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [emojiOpen])

  function warnOversize(file: File): void {
    toast.error(
      tChat('attachTooLarge', {
        name: file.name,
        max: formatBytes(maxUploadBytes(file.type), unitLabel),
      }),
    )
  }

  const send = useMutation({
    mutationFn: async (vars: SendVars): Promise<unknown> => {
      const replyToId = replyTo?.id
      // Простой текст — ручкой поддержки: она пишет ответ в аудит.
      if (vars.files.length === 0 && !replyToId) {
        return replySupportRequest(ticketId, vars.content)
      }
      // Как в чате: «без сжатия» отправляет байты как есть, кроме HEIC — его сервер не примет.
      const ready = vars.asFiles
        ? await convertUnsupportedImages(vars.files)
        : await compressImages(vars.files)
      const oversize = ready.find((f) => f.size > maxUploadBytes(f.type))
      if (oversize) throw new OversizeError(oversize)
      // Спойлер отмечен на исходных файлах; сжатие сохраняет порядок — сверяем по позиции.
      const spoilerIndexes = vars.files.flatMap((f, i) => (vars.spoilered?.includes(f) ? [i] : []))
      const fields = {
        content: vars.content || undefined,
        replyToId,
        spoilerIndexes: spoilerIndexes.length > 0 ? spoilerIndexes : undefined,
        asFiles: vars.asFiles || undefined,
      }
      return ready.some((f) => needsDirectUpload(f.size))
        ? sendMessageWithDirectUpload(ticketId, fields, ready)
        : sendMessageWithAttachments(ticketId, fields, ready)
    },
    onError: (e) => {
      if (e instanceof OversizeError) warnOversize(e.file)
      else toast.error(tErr(toApiError(e).code))
    },
  })

  const voice = useVoiceRecorder({
    onRecorded: (file) => send.mutate({ content: '', files: [file] }, { onSuccess: onSent }),
    onError: (kind) =>
      toast.error(tChat(kind === 'unsupported' ? 'recordUnsupported' : 'recordDenied')),
  })

  function sendText(): void {
    const content = text.trim()
    if (!content || send.isPending) return
    send.mutate(
      { content, files: [] },
      {
        onSuccess: () => {
          setText('')
          onSent()
        },
      },
    )
  }

  /**
   * Отправка из диалога вложений. Альбом — до {@link ALBUM_MAX_ITEMS} файлов одним
   * сообщением, больше — несколькими; «без группировки» — по сообщению на файл.
   * Подпись уходит с первым.
   */
  async function sendFiles(caption: string, options: AttachmentSendOptions): Promise<void> {
    const batches: File[][] = []
    if (options.grouped) {
      for (let i = 0; i < files.length; i += ALBUM_MAX_ITEMS) {
        batches.push(files.slice(i, i + ALBUM_MAX_ITEMS))
      }
    } else {
      for (const f of files) batches.push([f])
    }
    try {
      for (const [i, batch] of batches.entries()) {
        await send.mutateAsync({
          content: i === 0 ? caption.trim() : '',
          files: batch,
          spoilered: options.spoilered,
          asFiles: options.asFiles,
        })
      }
      setFiles([])
      onSent()
    } catch {
      // Тост уже показал onError; диалог остаётся открытым — можно повторить.
    }
  }

  function pickFiles(list: FileList | null): void {
    const fits = Array.from(list ?? []).filter((f) => {
      if (!isOversizeOnPick(f)) return true
      warnOversize(f)
      return false
    })
    if (fits.length > 0) setFiles((prev) => [...prev, ...fits])
  }

  function insertEmoji(emoji: string): void {
    const el = textRef.current
    const at = el?.selectionStart ?? text.length
    setText(`${text.slice(0, at)}${emoji}${text.slice(el?.selectionEnd ?? at)}`)
    requestAnimationFrame(() => {
      const pos = at + emoji.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendText()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Закрытое обращение отвечать не мешает, но об этом говорим заранее, а не подсказкой
          в пустом поле, которая пропадает с первой буквой. */}
      {closedTicket && <p className="text-xs text-muted-foreground">{t('replyReopens')}</p>}
      {replyTo && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
          <Reply className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col text-xs">
            <span className="font-semibold text-primary">
              {tChat('replyingTo', {
                name: `${replyTo.sender.lastName} ${replyTo.sender.firstName}`,
              })}
            </span>
            <span className="truncate text-muted-foreground">{replyTo.content || t('noText')}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={tChat('cancelReply')}
            className="size-7"
            onClick={onCancelReply}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      {/* Скрытые поля выбора: фото и видео отдельно от файлов — иначе галерея телефона
          открывается на всех документах. */}
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          pickFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          pickFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {voice.recording ? (
        // Строка записи: отмена · таймер + волны · пауза/продолжить · отправить — как в чате.
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            icon
            aria-label={tChat('cancelRecording')}
            className="text-destructive hover:text-destructive"
            onClick={voice.cancel}
          >
            <Trash2 className="size-5" aria-hidden />
          </Button>
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-muted px-3">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full bg-destructive',
                !voice.paused && 'animate-pulse',
              )}
              aria-hidden
            />
            <span className="w-10 shrink-0 text-sm tabular-nums text-muted-foreground">
              {`${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`}
            </span>
            <VoiceWaveform analyserRef={voice.analyserRef} paused={voice.paused} />
          </div>
          <Button
            variant="ghost"
            icon
            aria-label={voice.paused ? tChat('resumeRecording') : tChat('pauseRecording')}
            onClick={voice.paused ? voice.resume : voice.pause}
          >
            {voice.paused ? (
              <Play className="size-5" aria-hidden />
            ) : (
              <Pause className="size-5" aria-hidden />
            )}
          </Button>
          <Button icon aria-label={t('send')} onClick={voice.finish}>
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                icon
                aria-label={tChat('attach')}
                title={tChat('attach')}
                disabled={send.isPending}
                className="text-muted-foreground"
              >
                <Paperclip className="size-5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onSelect={() => mediaInputRef.current?.click()}>
                <ImageIcon className="size-4" aria-hidden />
                {tChat('attachPhoto')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                <FileText className="size-4" aria-hidden />
                {tChat('attachFile')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="relative flex min-w-0 flex-1 items-end rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring dark:bg-input/30">
            <Textarea
              ref={textRef}
              rows={1}
              value={text}
              maxLength={4000}
              placeholder={t('replyPlaceholder')}
              aria-label={t('replyPlaceholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                // Вставленный снимок или файл — во вложения, как в чате.
                if (e.clipboardData.files.length > 0) {
                  e.preventDefault()
                  pickFiles(e.clipboardData.files)
                }
              }}
              className="field-sizing-content max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none hover:border-0 focus-visible:ring-0 dark:bg-transparent"
            />
            <div ref={emojiRef} className="relative shrink-0 p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon
                aria-label={tChat('emoji')}
                aria-expanded={emojiOpen}
                className="size-8 text-muted-foreground"
                onClick={() => setEmojiOpen((v) => !v)}
              >
                <Smile className="size-5" aria-hidden />
              </Button>
              {emojiOpen && (
                <div className="absolute right-0 bottom-full z-50 pb-2">
                  <EmojiPicker
                    size="lg"
                    searchPlaceholder={tChat('emojiSearch')}
                    onPick={insertEmoji}
                  />
                </div>
              )}
            </div>
          </div>

          {text.trim().length > 0 ? (
            <Button
              type="button"
              icon
              aria-label={t('send')}
              loading={send.isPending}
              onClick={sendText}
            >
              <Send className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              icon
              aria-label={tChat('recordVoice')}
              title={tChat('recordVoice')}
              loading={send.isPending}
              className="text-muted-foreground"
              onClick={() => void voice.start()}
            >
              <Mic className="size-5" aria-hidden />
            </Button>
          )}
        </div>
      )}

      {files.length > 0 && (
        <AttachmentDialog
          files={files}
          sending={send.isPending}
          onSend={(caption, options) => void sendFiles(caption, options)}
          onAddMore={() => mediaInputRef.current?.click()}
          onRemove={(index) => setFiles((prev) => prev.filter((_, i) => i !== index))}
          onClose={() => setFiles([])}
        />
      )}
    </div>
  )
}
