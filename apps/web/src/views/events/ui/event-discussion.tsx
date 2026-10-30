'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
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
  addEventCommentRequest,
  deleteEventCommentRequest,
  eventKeys,
  fetchEventCommentAttachmentLink,
  fetchEventComments,
  toggleEventCommentReactionRequest,
  type EventComment,
  type EventCommentReply,
  type EventCommentsPage,
} from '../../../entities/event'
import {
  ALBUM_MAX_ITEMS,
  AttachmentDialog,
  AttachmentLinkProvider,
  MessageAttachments,
  MessageContent,
  MessageContextMenu,
  ReactionBar,
  VoiceWaveform,
  compressImages,
  convertUnsupportedImages,
  useVoiceRecorder,
  type AttachmentLinkSource,
  type AttachmentSendOptions,
  type MessageMenuAnchor,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { uploadToBucket } from '../../../shared/api'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  captureAnchor,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmojiPicker,
  Skeleton,
  Textarea,
  useConfirm,
} from '../../../shared/ui'
import {
  cn,
  formatBytes,
  isOversizeOnPick,
  maxUploadBytes,
  toApiError,
  useByteUnitLabel,
} from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'

// Подряд идущие комментарии одного автора склеиваются в серию, как в чате: имя и аватар —
// только у первого. Перерыв дольше этого начинает новую серию.
const RUN_GAP_MS = 5 * 60 * 1000

type CommentsData = InfiniteData<EventCommentsPage, string | undefined>

/**
 * Обсуждение события в виде чата: пузыри, ответы с цитатой, реакции, вложения (фото, видео,
 * файлы, голосовые) и смайлы. Внешний вид и вложения — компоненты чата; ссылки на файлы
 * выдаёт эндпоинт события (AttachmentLinkProvider), со своей проверкой доступа.
 */
export function EventDiscussion({
  eventId,
  canModerate,
}: {
  eventId: string
  canModerate: boolean
}) {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const tChat = useTranslations('Chats')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const [replyTo, setReplyTo] = useState<EventComment | null>(null)
  // Меню комментария по правому клику — то же, что в чате; пункты — те, что бывают здесь.
  const [menu, setMenu] = useState<{
    comment: EventComment
    x: number
    y: number
    anchor?: MessageMenuAnchor
  } | null>(null)

  // Страницы — свежие сверху; «Показать предыдущие» догружает более ранние (E-F12).
  const comments = useInfiniteQuery({
    queryKey: eventKeys.comments(eventId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchEventComments(eventId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: EventCommentsPage) => (last.hasNext ? last.cursor : undefined),
  })

  const linkSource = useMemo<AttachmentLinkSource>(
    () => ({
      scope: `event-comment-attachment:${eventId}`,
      fetch: (fileId) => fetchEventCommentAttachmentLink(eventId, fileId),
    }),
    [eventId],
  )

  const remove = useMutation({
    mutationFn: (commentId: string) => deleteEventCommentRequest(eventId, commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: eventKeys.comments(eventId) }),
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Реакции сервер возвращает целиком — кладём их прямо в кэш, без перечитывания страниц.
  const react = useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
      toggleEventCommentReactionRequest(eventId, commentId, emoji),
    onSuccess: (reactions, { commentId }) => {
      qc.setQueryData<CommentsData>(eventKeys.comments(eventId), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map((c) => (c.id === commentId ? { ...c, reactions } : c)),
              })),
            }
          : data,
      )
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const pages = comments.data?.pages ?? []
  // На экране — по порядку написания: самые старые сверху, свежие у поля ввода.
  const items = pages.flatMap((p) => p.items).reverse()
  // Счётчик — со всего обсуждения, а не с догруженных страниц.
  const total = pages[0]?.total ?? items.length

  // Обсуждение прокручивается внутри карточки, свежее — внизу, у поля ввода. Прокручиваем
  // к нему при загрузке и при новом комментарии; догрузка ранних самый свежий не меняет —
  // и читатель остаётся там, где был.
  const listRef = useRef<HTMLDivElement>(null)
  const newestId = items.at(-1)?.id
  useEffect(() => {
    const list = listRef.current
    if (list && newestId) list.scrollTop = list.scrollHeight
  }, [newestId])

  function jumpTo(commentId: string): void {
    const el = document.getElementById(`event-comment-${commentId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Подсветка, чтобы глаз нашёл оригинал среди соседей, — как переход к цитате в чате.
    el.dataset.flash = 'true'
    window.setTimeout(() => delete el.dataset.flash, 1200)
  }

  function deleteComment(c: EventComment, own: boolean): void {
    // Свой — сразу; чужой — решение модерации: с подтверждением, оно в аудите.
    if (own) {
      remove.mutate(c.id)
      return
    }
    void confirm({
      title: t('deleteCommentConfirm'),
      description: t('moderationDeleteHint'),
      confirmLabel: t('deleteCommentModeration'),
      destructive: true,
    }).then((ok) => {
      if (ok) remove.mutate(c.id)
    })
  }

  return (
    <Card className="flex flex-col gap-3 p-4 lg:min-h-72 lg:flex-1">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {t('comments')}
        {total > 0 && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{total}</span>
        )}
      </h2>

      <AttachmentLinkProvider source={linkSource}>
        <div ref={listRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {comments.isLoading ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : comments.isError ? (
            <p className="text-sm text-muted-foreground">{tErr(toApiError(comments.error).code)}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noComments')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 pb-1">
              {comments.hasNextPage && (
                <li className="pb-2">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    loading={comments.isFetchingNextPage}
                    onClick={() => void comments.fetchNextPage()}
                  >
                    {t('showEarlierComments')}
                  </Button>
                </li>
              )}
              {items.map((c, i) => {
                const prev = items[i - 1]
                const firstOfRun =
                  !prev ||
                  prev.author.id !== c.author.id ||
                  new Date(c.createdAt).getTime() - new Date(prev.createdAt).getTime() > RUN_GAP_MS
                const own = c.author.id === myId
                return (
                  <CommentBubble
                    key={c.id}
                    comment={c}
                    mine={own}
                    firstOfRun={firstOfRun}
                    myId={myId}
                    canDelete={c.canDelete ?? (own || canModerate)}
                    deleting={remove.isPending && remove.variables === c.id}
                    onReply={() => setReplyTo(c)}
                    onReact={(emoji) => react.mutate({ commentId: c.id, emoji })}
                    onDelete={() => deleteComment(c, own)}
                    onJumpTo={jumpTo}
                    onOpenMenu={(x, y, anchor) => setMenu({ comment: c, x, y, anchor })}
                  />
                )
              })}
            </ul>
          )}
        </div>
      </AttachmentLinkProvider>

      {menu && (
        <MessageContextMenu
          message={menu.comment}
          mine={menu.comment.author.id === myId}
          canDelete={menu.comment.canDelete ?? (menu.comment.author.id === myId || canModerate)}
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          actions={{
            onReact: (emoji) => react.mutate({ commentId: menu.comment.id, emoji }),
            onReply: () => setReplyTo(menu.comment),
            onCopy: () => {
              void navigator.clipboard?.writeText(menu.comment.content)
              toast.success(tChat('copied'))
            },
            onDelete: () => deleteComment(menu.comment, menu.comment.author.id === myId),
          }}
        />
      )}

      <CommentComposer
        eventId={eventId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => {
          setReplyTo(null)
          void qc.invalidateQueries({ queryKey: eventKeys.comments(eventId) })
        }}
      />
    </Card>
  )
}

function initials(person: { firstName: string; lastName: string }): string {
  return `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()
}

/** Пузырь комментария: свой — справа и цветом, чужой — слева с аватаром, как в чате. */
function CommentBubble({
  comment: c,
  mine,
  firstOfRun,
  myId,
  canDelete,
  deleting,
  onReply,
  onReact,
  onDelete,
  onJumpTo,
  onOpenMenu,
}: {
  comment: EventComment
  mine: boolean
  firstOfRun: boolean
  myId: string | undefined
  canDelete: boolean
  deleting: boolean
  onReply: () => void
  onReact: (emoji: string) => void
  onDelete: () => void
  onJumpTo: (commentId: string) => void
  /** Правый клик (на телефоне — долгое нажатие): меню сообщения, как в чате. */
  onOpenMenu: (x: number, y: number, anchor?: MessageMenuAnchor) => void
}) {
  const t = useTranslations('Events')
  const tChat = useTranslations('Chats')
  const fmt = useFormatter()
  const media = c.media ?? []
  const reply = c.replyTo
  const authorName = `${c.author.lastName} ${c.author.firstName}`

  return (
    <li
      id={`event-comment-${c.id}`}
      onContextMenu={(e) => {
        e.preventDefault()
        // Долгое нажатие на тач-экране приходит тем же событием: меню тогда вырастает из
        // самого пузыря, как в чате. Мышью — у точки клика.
        const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
        onOpenMenu(e.clientX, e.clientY, touch ? captureAnchor(e.currentTarget) : undefined)
      }}
      className={cn(
        'group flex items-start gap-2 rounded-xl transition-colors data-[flash=true]:bg-primary/10',
        mine && 'flex-row-reverse',
        firstOfRun && 'mt-2 first:mt-0',
      )}
    >
      {!mine &&
        (firstOfRun ? (
          <ProfileLink userId={c.author.id} className="shrink-0">
            <Avatar className="size-8">
              {c.author.avatarThumbUrl && <AvatarImage src={c.author.avatarThumbUrl} alt="" />}
              <AvatarFallback className="text-xs">{initials(c.author)}</AvatarFallback>
            </Avatar>
          </ProfileLink>
        ) : (
          <span className="size-8 shrink-0" aria-hidden />
        ))}

      <div
        className={cn(
          'relative flex min-w-0 max-w-[75%] flex-col gap-1 rounded-2xl px-3 py-2 text-sm',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {!mine && firstOfRun && (
          <ProfileLink
            userId={c.author.id}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {authorName}
          </ProfileLink>
        )}
        {reply && <ReplyQuote reply={reply} mine={mine} onClick={() => onJumpTo(reply.id)} />}
        {media.length > 0 && (
          <MessageAttachments
            media={media}
            mine={mine}
            viewerMeta={{
              senderName: authorName,
              createdAt: c.createdAt,
              mine,
              caption: c.content || undefined,
            }}
          />
        )}
        {c.content && (
          <div className="break-words">
            <MessageContent content={c.content} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ReactionBar
            reactions={c.reactions ?? []}
            myId={myId}
            ownBubble={mine}
            onToggle={onReact}
          />
          <time
            dateTime={c.createdAt}
            className={cn(
              'text-[11px] tabular-nums',
              mine ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}
          >
            {fmt.dateTime(new Date(c.createdAt), {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
      </div>

      {/* Действия над комментарием — у пузыря при наведении; на тач-экране видны всегда. */}
      <div className="flex shrink-0 items-center self-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
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
          <DropdownMenuContent align={mine ? 'end' : 'start'} className="flex gap-0.5 p-1">
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
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={mine ? t('deleteComment') : t('deleteCommentModeration')}
            title={mine ? t('deleteComment') : t('deleteCommentModeration')}
            loading={deleting}
            onClick={onDelete}
            className="size-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  )
}

/** Цитата оригинала в ответе — полоска слева и одна строка, как в чате. */
function ReplyQuote({
  reply,
  mine,
  onClick,
}: {
  reply: EventCommentReply
  mine: boolean
  onClick?: () => void
}) {
  const t = useTranslations('Events')
  const text = reply.deleted
    ? t('replyQuoteDeleted')
    : reply.content || t('replyQuoteMedia', { count: reply.mediaCount })
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={reply.deleted}
      className={cn(
        'flex min-w-0 flex-col rounded-md border-l-2 px-2 py-1 text-left text-xs',
        mine
          ? 'border-primary-foreground/70 bg-primary-foreground/10'
          : 'border-primary bg-primary/10',
      )}
    >
      <span className="truncate font-semibold">
        {reply.author.lastName} {reply.author.firstName}
      </span>
      <span className={cn('truncate', reply.deleted && 'italic opacity-80')}>{text}</span>
    </button>
  )
}

interface SendVars {
  content: string
  files: File[]
  spoilered?: File[]
  asDocument?: boolean
}

/** Файл не влез в свой лимит даже после сжатия — сообщаем имя и сам лимит. */
class OversizeError extends Error {
  constructor(readonly file: File) {
    super('oversize')
  }
}

/**
 * Поле ввода как в чате: смайлы, вложения (фото и видео, файлы — через диалог отправки чата),
 * голосовое и ответ на комментарий. Файлы грузятся в бакет постов, комментарий привязывает их
 * по id. Enter отправляет, Shift+Enter — перенос строки.
 */
function CommentComposer({
  eventId,
  replyTo,
  onCancelReply,
  onSent,
}: {
  eventId: string
  replyTo: EventComment | null
  onCancelReply: () => void
  onSent: () => void
}) {
  const t = useTranslations('Events')
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

  // Ответ выбран — сразу в поле: человек нажал «Ответить», чтобы писать.
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
    mutationFn: async (vars: SendVars) => {
      // Как в чате: «без сжатия» отправляет байты как есть, кроме HEIC — его сервер не примет.
      const ready = vars.asDocument
        ? await convertUnsupportedImages(vars.files)
        : await compressImages(vars.files)
      const oversize = ready.find((f) => f.size > maxUploadBytes(f.type))
      if (oversize) throw new OversizeError(oversize)
      const uploaded = await Promise.all(ready.map((f) => uploadToBucket('POSTS', f)))
      const mediaIds = uploaded.map((u) => u.id)
      // Спойлер отмечен на исходных файлах; сжатие сохраняет порядок — сверяем по позиции.
      const spoilerIds = vars.files.flatMap((f, i) =>
        vars.spoilered?.includes(f) && mediaIds[i] ? [mediaIds[i]] : [],
      )
      return addEventCommentRequest(eventId, {
        ...(vars.content ? { content: vars.content } : {}),
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
        ...(spoilerIds.length > 0 ? { spoilerIds } : {}),
        ...(vars.asDocument ? { asDocument: true } : {}),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      })
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
   * комментарием, больше — несколькими; «без группировки» — по комментарию на файл.
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
          asDocument: options.asFiles,
        })
      }
      setFiles([])
      onSent()
    } catch {
      // Тост уже показал onError; диалог остаётся открытым — можно повторить.
    }
  }

  function pickFiles(list: FileList | null): void {
    const picked = Array.from(list ?? [])
    const fits = picked.filter((f) => {
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

  const hasText = text.trim().length > 0

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {replyTo && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
          <Reply className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col text-xs">
            <span className="font-semibold text-primary">
              {tChat('replyingTo', {
                name: `${replyTo.author.lastName} ${replyTo.author.firstName}`,
              })}
            </span>
            <span className="truncate text-muted-foreground">
              {replyTo.content || t('replyQuoteMedia', { count: replyTo.media?.length ?? 0 })}
            </span>
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
          <Button icon aria-label={tChat('send')} onClick={voice.finish}>
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

          <div className="relative flex min-w-0 flex-1 items-end rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              ref={textRef}
              rows={1}
              value={text}
              maxLength={2000}
              placeholder={t('commentPlaceholder')}
              aria-label={t('commentPlaceholder')}
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

          {hasText ? (
            <Button
              type="button"
              icon
              aria-label={t('sendComment')}
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
