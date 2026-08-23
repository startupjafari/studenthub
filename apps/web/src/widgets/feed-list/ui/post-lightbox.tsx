'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Repeat2,
  Share2,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  addCommentRequest,
  addReactionRequest,
  canRepost,
  deleteCommentRequest,
  deletePostRequest,
  fetchComments,
  incrementPostView,
  pinPostRequest,
  postKeys,
  removeReactionRequest,
  type FeedPost,
  type PostReaction,
} from '../../../entities/post'
import {
  chatKeys,
  fetchChats,
  sharePostRequest,
  ForwardDialog,
  type ChatListItem,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { RepostDialog } from '../../../features/repost-post'
import type { PostAuthor } from '../../../entities/post'
import { Avatar, AvatarFallback, AvatarImage, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { BRAND_GRADIENT } from '../../../shared/config'
import { useBodyScrollLock } from '../../../shared/lib'
import { PostMediaView } from './post-media'

const LIKE = '❤️'

// Быстрый набор эмодзи для комментариев (как в чате).
const EMOJI_SET = [
  '😀',
  '😂',
  '😍',
  '🥰',
  '😎',
  '🤩',
  '😅',
  '😊',
  '👍',
  '👏',
  '🙌',
  '🔥',
  '❤️',
  '💯',
  '🎉',
  '✨',
  '😮',
  '🤔',
  '🙏',
  '💪',
  '✅',
  '⭐',
  '😢',
  '😉',
]

// Компактное относительное время в стиле Instagram («5 нед. назад», «2 ч. назад»).
const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]
function relTime(iso: string, locale: string): string {
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, secs] of REL_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit)
  }
  return rtf.format(Math.round(diffSec / 60), 'minute')
}
const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

function chatLabel(c: ChatListItem, tChats: (k: string) => string): string {
  return c.title || c.subject || tChats('typePrivate')
}

interface LightboxProps {
  posts: FeedPost[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  // Открыть с фокусом на поле комментария (клик по иконке комментария в плитке профиля).
  focusComment?: boolean
}

// Лайтбокс поста (Instagram-стиль): медиа/обложка слева, детали и комментарии справа.
// Внешние стрелки листают посты в наборе; карусель внутри — медиа текущего поста.
export function PostLightbox({
  posts,
  index,
  onIndex,
  onClose,
  focusComment = false,
}: LightboxProps) {
  const t = useTranslations('Feed')
  useBodyScrollLock()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && index < posts.length - 1) onIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [index, posts.length, onClose, onIndex])

  if (typeof document === 'undefined') return null
  const post = posts[index]
  if (!post) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-0 backdrop-blur-sm animate-in fade-in-0 duration-150 sm:px-6 sm:pt-6 sm:pb-16"
    >
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute right-3 top-3 z-20 flex size-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
      >
        <X className="size-6" aria-hidden />
      </button>

      {index > 0 && (
        <button
          type="button"
          aria-label={t('prevPost')}
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
          className="absolute left-2 z-20 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-4"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
      )}
      {index < posts.length - 1 && (
        <button
          type="button"
          aria-label={t('nextPost')}
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index + 1)
          }}
          className="absolute right-2 z-20 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4"
        >
          <ChevronRight className="size-6" aria-hidden />
        </button>
      )}

      {posts.length > 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white tabular-nums backdrop-blur-sm">
          {t('counter', { current: index + 1, total: posts.length })}
        </div>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden bg-background shadow-2xl sm:rounded-xl md:flex-row"
      >
        <PostView key={post.id} post={post} onClose={onClose} focusComment={focusComment} />
      </div>
    </div>,
    document.body,
  )
}

// Содержимое одного поста в лайтбоксе. Ремонтируется по key={post.id} — состояние
// (карусель, реакции, ввод) сбрасывается при переходе к другому посту.
function PostView({
  post,
  onClose,
  focusComment = false,
}: {
  post: FeedPost
  onClose: () => void
  focusComment?: boolean
}) {
  const t = useTranslations('Feed')
  const tChats = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const [mi, setMi] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [views, setViews] = useState(post.views)
  const [reactions, setReactions] = useState<PostReaction[]>(post.reactions)

  // Засчитываем просмотр один раз при открытии поста (PostView ремонтируется по key={post.id}).
  useEffect(() => {
    incrementPostView(post.id)
      .then(setViews)
      .catch(() => {})
  }, [post.id])
  const [sharing, setSharing] = useState(false)
  const [reposting, setReposting] = useState(false)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  // Закрытие всплывающих окон по клику вне их области и по Esc (без закрытия при отводе мыши).
  useEffect(() => {
    if (!menuOpen && !emojiOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false)
      if (emojiOpen && emojiRef.current && !emojiRef.current.contains(target)) setEmojiOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Esc закрывает сначала всплывающее окно, а не весь лайтбокс.
        e.stopPropagation()
        setMenuOpen(false)
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, emojiOpen])

  // Ответить: подставляем «@Имя » и ставим курсор после упоминания (текст печатается следом).
  function startReply(commentId: string, author: PostAuthor): void {
    setReplyTo(commentId)
    const mention = `@${author.lastName} ${author.firstName} `
    setText(mention)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(mention.length, mention.length)
    })
  }

  // Вставка эмодзи в позицию курсора (или в конец).
  function insertEmoji(emoji: string): void {
    const el = inputRef.current
    if (!el) {
      setText((p) => p + emoji)
      return
    }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    })
  }

  // Авто-высота поля ввода под многострочный текст (перенос строки по Shift+Enter).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }, [text])

  // Открытие «на комментарий» — сразу фокус в поле ввода.
  useEffect(() => {
    if (focusComment) requestAnimationFrame(() => inputRef.current?.focus())
  }, [focusComment])

  const canModerate = myRole !== null && MODERATOR_ROLES.includes(myRole)
  const canDelete = post.authorId === myId || canModerate
  const showRepost = canRepost(myRole, post)
  const liked = reactions.some((r) => r.emoji === LIKE && r.userId === myId)

  const chats = useQuery({ queryKey: chatKeys.list(), queryFn: fetchChats, enabled: sharing })
  const comments = useQuery({
    queryKey: postKeys.comments(post.id),
    queryFn: () => fetchComments(post.id),
  })

  const shareMut = useMutation({
    mutationFn: (chatId: string) => sharePostRequest(chatId, post.id),
    onSuccess: () => {
      setSharing(false)
      toast.success(t('sharedToChat'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const addMut = useMutation({
    mutationFn: () =>
      addCommentRequest(post.id, { content: text.trim(), parentId: replyTo ?? undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.comments(post.id) })
      void qc.invalidateQueries({ queryKey: postKeys.all })
      setText('')
      setReplyTo(null)
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const delCommentMut = useMutation({
    mutationFn: (commentId: string) => deleteCommentRequest(post.id, commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postKeys.comments(post.id) }),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const delPostMut = useMutation({
    mutationFn: () => deletePostRequest(post.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('deleted'))
      onClose()
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const pinMut = useMutation({
    mutationFn: () => pinPostRequest(post.id, post.pinnedAt === null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postKeys.all }),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Оптимистичный лайк ❤️ с откатом (docs/FRONTEND_RULES.md §5.5).
  function toggleLike(): void {
    if (!myId) return
    const prev = reactions
    if (liked) {
      setReactions(prev.filter((r) => !(r.emoji === LIKE && r.userId === myId)))
      removeReactionRequest(post.id, LIKE).catch(() => {
        setReactions(prev)
        toast.error(tErr('INTERNAL_ERROR'))
      })
    } else {
      setReactions([...prev, { emoji: LIKE, userId: myId }])
      addReactionRequest(post.id, LIKE).catch(() => {
        setReactions(prev)
        toast.error(tErr('INTERNAL_ERROR'))
      })
    }
  }

  const time = new Date(post.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const media = post.media
  const cur = media[mi]
  const isImage = cur ? !cur.mime.startsWith('video/') : false
  const commentCount = comments.data?.length ?? post._count.comments
  const roots = (comments.data ?? []).filter((c) => c.parentId === null)
  const repliesOf = (id: string) => (comments.data ?? []).filter((c) => c.parentId === id)

  return (
    <>
      {/* Медиа-колонка — нейтральный тёмно-серый фон вместо чёрного */}
      <div className="relative flex min-h-[45vh] flex-1 items-center justify-center overflow-hidden bg-neutral-900 md:min-h-0">
        {cur ? (
          isImage ? (
            <button
              type="button"
              aria-label={zoomed ? t('zoomOut') : t('zoomIn')}
              onClick={() => setZoomed((z) => !z)}
              className={cn(
                'flex size-full items-center justify-center',
                zoomed ? 'cursor-zoom-out overflow-auto' : 'cursor-zoom-in',
              )}
            >
              <PostMediaView
                postId={post.id}
                media={cur}
                fit="contain"
                className={cn(
                  'max-h-[45vh] w-full transition-transform duration-200 md:max-h-[92vh]',
                  zoomed && 'max-h-none scale-150 md:scale-[1.75]',
                )}
              />
            </button>
          ) : (
            <PostMediaView
              postId={post.id}
              media={cur}
              fit="contain"
              controls
              className="max-h-[45vh] w-full md:max-h-[92vh]"
            />
          )
        ) : (
          <div className={cn('flex size-full items-center justify-center p-8', BRAND_GRADIENT)}>
            <p className="max-h-full overflow-y-auto whitespace-pre-wrap text-center text-lg font-medium text-white">
              {post.content}
            </p>
          </div>
        )}

        {media.length > 1 && (
          <>
            {mi > 0 && (
              <button
                type="button"
                aria-label={t('prev')}
                onClick={() => {
                  setMi(mi - 1)
                  setZoomed(false)
                }}
                className="absolute left-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
            )}
            {mi < media.length - 1 && (
              <button
                type="button"
                aria-label={t('next')}
                onClick={() => {
                  setMi(mi + 1)
                  setZoomed(false)
                }}
                className="absolute right-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
            )}
            {/* Номер материала: «2 из 8» */}
            <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white tabular-nums">
              {t('counter', { current: mi + 1, total: media.length })}
            </div>
            <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {media.map((m, i) => (
                <span
                  key={m.id}
                  className={cn(
                    'size-1.5 rounded-full transition-colors',
                    i === mi ? 'bg-white' : 'bg-white/40',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Панель деталей — на мобильном нижний лист (bottom sheet) с «выглядывающей» полосой */}
      <div
        className={cn(
          'flex flex-col bg-background',
          'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:max-h-[82vh] max-md:rounded-t-2xl max-md:border-t max-md:border-border max-md:shadow-2xl max-md:transition-transform max-md:duration-300',
          !sheetOpen && 'max-md:translate-y-[calc(100%-2.75rem)]',
          'md:w-[400px] md:shrink-0 md:border-l md:border-border',
        )}
      >
        {/* Ручка-переключатель (только мобильный) */}
        <button
          type="button"
          onClick={() => setSheetOpen((o) => !o)}
          className="flex w-full shrink-0 items-center justify-center gap-2 border-b border-border py-2.5 text-sm text-muted-foreground md:hidden"
        >
          <MessageCircle className="size-4" aria-hidden />
          {t('commentsCount', { count: commentCount })}
        </button>

        {/* Шапка */}
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <ProfileLink userId={post.author.id} className="shrink-0">
            <Avatar className="size-9">
              {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt="" />}
              <AvatarFallback>{initials(post.author)}</AvatarFallback>
            </Avatar>
          </ProfileLink>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">
              <ProfileLink userId={post.author.id} className="hover:text-primary hover:underline">
                {post.author.lastName} {post.author.firstName}
              </ProfileLink>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {t(`audience${post.audience}`)}
            </p>
          </div>
          {post.pinnedAt && <Pin className="size-4 shrink-0 text-primary" aria-hidden />}
          {(canModerate || canDelete) && (
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                aria-label={t('postActions')}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  menuOpen && 'bg-muted text-foreground',
                )}
              >
                <MoreHorizontal className="size-5" aria-hidden />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg">
                  {canModerate && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        pinMut.mutate()
                      }}
                      className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-muted"
                    >
                      <Pin
                        className={cn(
                          'size-4 shrink-0',
                          post.pinnedAt && 'fill-current text-primary',
                        )}
                        aria-hidden
                      />
                      {post.pinnedAt ? t('unpin') : t('pin')}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        void confirm({ title: t('deleteConfirm'), destructive: true }).then(
                          (ok) => {
                            if (ok) delPostMut.mutate()
                          },
                        )
                      }}
                      className="flex h-9 w-full items-center gap-2 px-3 text-sm text-destructive transition-colors hover:bg-muted"
                    >
                      <Trash2 className="size-4 shrink-0" aria-hidden />
                      {t('delete')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </header>

        {/* Подпись автора (первой строкой, как в Instagram) + комментарии (скролл) */}
        <ul className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
          {post.content && (
            <li>
              <CommentRow
                author={post.author}
                content={post.content}
                createdAt={post.createdAt}
                locale={locale}
              />
            </li>
          )}

          {/* Репост: цитата первоисточника — иначе в полном просмотре не видно, что это репост */}
          {post.original && (
            <li>
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Repeat2 className="size-3.5" aria-hidden />
                  <ProfileLink
                    userId={post.original.author.id}
                    className="hover:text-primary hover:underline"
                  >
                    {post.original.author.lastName} {post.original.author.firstName}
                  </ProfileLink>
                </p>
                <p className="whitespace-pre-wrap">{post.original.content}</p>
              </div>
            </li>
          )}

          {comments.isLoading ? (
            <li className="text-xs text-muted-foreground">{t('loadingComments')}</li>
          ) : roots.length === 0 ? (
            <li className="text-xs text-muted-foreground">{t('noComments')}</li>
          ) : (
            roots.map((c) => {
              const replies = repliesOf(c.id)
              return (
                <li key={c.id} className="flex flex-col gap-3">
                  {/* Одиночный комментарий (корень ветки) */}
                  <CommentRow
                    author={c.author}
                    content={c.content}
                    createdAt={c.createdAt}
                    locale={locale}
                    canDelete={c.author.id === myId}
                    onReply={() => startReply(c.id, c.author)}
                    onDelete={() => delCommentMut.mutate(c.id)}
                  />
                  {/* Ответы — с отступом и вертикальной линией-веткой (визуально отделены) */}
                  {replies.length > 0 && (
                    <div className="ml-4 flex flex-col gap-3 border-l-2 border-border/70 pl-3.5">
                      {replies.map((r) => (
                        <CommentRow
                          key={r.id}
                          author={r.author}
                          content={r.content}
                          createdAt={r.createdAt}
                          locale={locale}
                          small
                          canDelete={r.author.id === myId}
                          onReply={() => startReply(c.id, r.author)}
                          onDelete={() => delCommentMut.mutate(r.id)}
                        />
                      ))}
                    </div>
                  )}
                </li>
              )
            })
          )}
        </ul>

        {/* Действия + лайки + дата */}
        <div className="border-t border-border px-4 pb-2 pt-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label={t('like')}
              aria-pressed={liked}
              onClick={toggleLike}
              className="cursor-pointer transition-transform hover:scale-110"
            >
              <Heart
                className={cn(
                  'size-6',
                  liked ? 'fill-destructive text-destructive' : 'text-foreground',
                )}
                aria-hidden
              />
            </button>
            <button
              type="button"
              aria-label={t('comment')}
              onClick={() => inputRef.current?.focus()}
              className="cursor-pointer transition-transform hover:scale-110"
            >
              <MessageCircle className="size-6" aria-hidden />
            </button>
            {showRepost && (
              <button
                type="button"
                aria-label={t('repost')}
                onClick={() => setReposting(true)}
                className="cursor-pointer transition-transform hover:scale-110"
              >
                <Repeat2 className="size-6" aria-hidden />
              </button>
            )}
            <button
              type="button"
              aria-label={t('shareToChat')}
              onClick={() => setSharing(true)}
              className="cursor-pointer transition-transform hover:scale-110"
            >
              <Share2 className="size-6" aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-sm font-semibold">
            {t('likesCount', { count: reactions.length })}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wide">{time}</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" aria-hidden />
              {t('viewsCount', { count: views })}
            </span>
          </p>
        </div>

        {/* Ввод комментария (плоский, как в Instagram): эмодзи · многострочное поле · «Опубликовать» */}
        <div className="relative flex items-end gap-2 border-t border-border px-4 py-2.5">
          {/* Пикер эмодзи */}
          <div ref={emojiRef} className="relative shrink-0">
            <button
              type="button"
              aria-label={t('emoji')}
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((o) => !o)}
              className={cn(
                'flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                emojiOpen && 'bg-muted text-foreground',
              )}
            >
              <Smile className="size-6" aria-hidden />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-border bg-popover p-2 shadow-lg">
                {EMOJI_SET.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => insertEmoji(e)}
                    className="flex size-7 items-center justify-center rounded-md text-lg transition-colors hover:bg-muted"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            onChange={(e) => {
              const v = e.target.value
              setText(v)
              // Очистка поля отменяет режим ответа (кнопки «Отмена» нет).
              if (v.trim() === '') setReplyTo(null)
            }}
            onKeyDown={(e) => {
              // Enter — отправить; Shift+Enter — перенос строки.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (text.trim().length > 0) addMut.mutate()
              }
            }}
            placeholder={replyTo ? t('replyPlaceholder') : t('commentPlaceholder')}
            className="max-h-28 min-h-8 min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-snug outline-none placeholder:text-muted-foreground"
          />

          <button
            type="button"
            onClick={() => addMut.mutate()}
            disabled={text.trim().length === 0 || addMut.isPending}
            className="shrink-0 self-center text-sm font-semibold text-primary transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            {t('publish')}
          </button>
        </div>
      </div>

      {reposting && <RepostDialog post={post} onClose={() => setReposting(false)} />}

      {sharing && (
        <ForwardDialog
          chats={chats.data ?? []}
          currentChatId={null}
          titleOf={(c) => chatLabel(c, tChats)}
          onPick={(chatId) => shareMut.mutate(chatId)}
          onClose={() => setSharing(false)}
        />
      )}
    </>
  )
}

// Строка контента (подпись автора или комментарий), симметрично: аватар · имя+текст · мета.
function CommentRow({
  author,
  content,
  createdAt,
  locale,
  canDelete = false,
  onReply,
  onDelete,
  small = false,
}: {
  author: PostAuthor
  content: string
  createdAt: string
  locale: string
  canDelete?: boolean
  onReply?: () => void
  onDelete?: () => void
  small?: boolean
}) {
  const t = useTranslations('Feed')
  return (
    <div className="group flex gap-2">
      <ProfileLink userId={author.id} className="shrink-0">
        <Avatar className={small ? 'size-6' : 'size-8'}>
          {author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
          <AvatarFallback className="text-[10px]">{initials(author)}</AvatarFallback>
        </Avatar>
      </ProfileLink>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <ProfileLink
            userId={author.id}
            className="mr-1.5 font-semibold hover:text-primary hover:underline"
          >
            {author.lastName} {author.firstName}
          </ProfileLink>
          <span className="whitespace-pre-wrap break-words">{content}</span>
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{relTime(createdAt, locale)}</span>
          {onReply && (
            <button type="button" onClick={onReply} className="font-medium hover:text-foreground">
              {t('reply')}
            </button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              {t('delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
