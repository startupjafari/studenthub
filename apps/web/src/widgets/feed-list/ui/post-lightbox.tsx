'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Eye,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Repeat2,
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
import { ProfileLink } from '../../../entities/user'
import { RepostDialog, useRepost } from '../../../features/repost-post'
import { ReportModal } from '../../../features/report-content'
import type { PostAuthor } from '../../../entities/post'
import { Avatar, AvatarFallback, AvatarImage, Markdown, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { relativeTime, useBackClose, useBodyScrollLock } from '../../../shared/lib'
import { SharePostMenu } from '../../../features/share-post'
import { MediaFrame } from './media-frame'
import { MentionSuggest, applyMention, mentionQuery } from './mention-suggest'

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
  useBackClose(onClose)

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

      {/* Пост — одной вертикальной колонкой, как во «ВКонтакте»: шапка, текст,
          вложение, действия, комментарии. Двухколоночная раскладка (медиа слева,
          панель справа) — это просмотрщик фотографий: у поста без картинки левая
          половина пустовала, а панель справа обрезала подписи кнопок. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[42rem] flex-col overflow-hidden bg-background shadow-2xl sm:rounded-2xl"
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
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const me = useAppSelector((s) => s.auth.user)
  const myId = me?.id
  const myRole = useAppSelector((s) => s.auth.role)

  const [mi, setMi] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const [views, setViews] = useState(post.views)
  const [reactions, setReactions] = useState<PostReaction[]>(post.reactions)

  // Засчитываем просмотр один раз при открытии поста (PostView ремонтируется по key={post.id}).
  useEffect(() => {
    incrementPostView(post.id)
      .then(setViews)
      .catch(() => {})
  }, [post.id])
  // Репост уходит в собственную ленту сразу по нажатию; окно остаётся только тем ролям,
  // у кого «своей» аудитории нет и цель приходится выбирать руками (useRepost).
  const { audience: repostAudience, repost, isPending: repostPending } = useRepost()
  const [repostDialog, setRepostDialog] = useState(false)
  const [text, setText] = useState('')
  // Порядок ленты комментариев. Своего ранжирования у нас нет, поэтому честные
  // «сначала новые / сначала старые», а не «сначала интересные».
  const [newestFirst, setNewestFirst] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  // Что набрано после «@» перед курсором. null — упоминание сейчас не пишут.
  const [mention, setMention] = useState<string | null>(null)
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
  // Кому отвечаем — показываем подписью над полем ввода. Раньше имя адресата
  // впечатывалось в текст реплики («@Иванов Иван …»), и оно уезжало на сервер
  // частью комментария: в ленте каждый ответ начинался с чужой фамилии.
  const [replyTarget, setReplyTarget] = useState<PostAuthor | null>(null)

  function startReply(commentId: string, author: PostAuthor): void {
    setReplyTo(commentId)
    setReplyTarget(author)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function cancelReply(): void {
    setReplyTo(null)
    setReplyTarget(null)
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

  const comments = useQuery({
    queryKey: postKeys.comments(post.id),
    queryFn: () => fetchComments(post.id),
  })

  const addMut = useMutation({
    mutationFn: () =>
      addCommentRequest(post.id, { content: text.trim(), parentId: replyTo ?? undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.comments(post.id) })
      void qc.invalidateQueries({ queryKey: postKeys.all })
      setText('')
      cancelReply()
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

  // Точная дата — в подсказке к относительному времени в панели действий.
  const exactDate = new Date(post.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const media = post.media
  const cur = media[mi]
  const isImage = cur ? !cur.mime.startsWith('video/') : false
  const commentCount = comments.data?.length ?? post._count.comments
  const loaded = comments.data ?? []
  const loadedIds = new Set(loaded.map((c) => c.id))
  // Корнем считаем и ответ, чей родитель не пришёл (родителя удалили): иначе такой
  // комментарий не рисовался нигде, а в счётчике оставался — заголовок обещал
  // «1 комментарий» над пустым списком.
  const roots = loaded
    .filter((c) => c.parentId === null || !loadedIds.has(c.parentId))
    // Ответы внутри ветки порядок не меняют: там важна последовательность разговора.
    .sort((a, b) =>
      newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
    )
  const repliesOf = (id: string) => loaded.filter((c) => c.parentId === id)

  /**
   * Панель действий стоит СРАЗУ под текстом поста, а не под лентой комментариев:
   * во «ВКонтакте» лайк и репост относятся к посту, и искать их в конце длинного
   * обсуждения приходилось прокруткой до дна.
   */
  function ActionsBar() {
    return (
      <div className="shrink-0 border-b border-border px-2 py-2">
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <BarButton
            label={t('like')}
            pressed={liked}
            count={reactions.length}
            onClick={toggleLike}
          >
            <Heart
              className={cn('size-5', liked && 'fill-destructive text-destructive')}
              aria-hidden
            />
          </BarButton>
          <BarButton
            label={t('comment')}
            count={commentCount}
            onClick={() => inputRef.current?.focus()}
          >
            <MessageCircle className="size-5" aria-hidden />
          </BarButton>
          {showRepost && (
            <BarButton
              label={t('repost')}
              disabled={repostPending}
              onClick={() => (repostAudience ? repost(post.id) : setRepostDialog(true))}
            >
              <Repeat2 className="size-5" aria-hidden />
            </BarButton>
          )}
          <SharePostMenu
            postId={post.id}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground"
          />
          {/* Просмотры и дата — справа, как во «ВКонтакте»: это показания, а не действия. */}
          {/* Справа только просмотры: дата переехала в шапку, под имя автора —
              в записи «ВКонтакте» она стоит там, а не в строке действий. */}
          <span
            className="ml-auto flex items-center gap-1.5 px-2 text-xs"
            title={t('viewsCount', { count: views })}
          >
            <Eye className="size-4" aria-hidden />
            {views}
          </span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="sh-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
          {cur && (
            <MediaFrame
              postId={post.id}
              media={cur}
              // Высота кадра ФИКСИРОВАННАЯ, а не «по картинке»: в карусели соседние
              // снимки бывают то горизонтальными, то вертикальными, и при height:auto
              // окно прыгало на каждом переключении — вместе с ним уезжали и кнопки
              // под ним. Размытая подложка заполняет поля, поэтому пустоты не видно.
              //
              // shrink-0 обязателен: это элемент прокручиваемой flex-колонки, и без
              // него длинная ветка комментариев сжимала кадр до нулевой высоты.
              className="h-[45vh] shrink-0 bg-neutral-900 sm:h-[60vh]"
              controls={!isImage}
              imageClassName={cn(
                'max-h-full transition-transform duration-200',
                zoomed && 'max-h-none scale-150',
              )}
            >
              {/* Кадр кликабелен целиком: приближение — по картинке, а не по кнопке
                  поверх неё, иначе клик по размытым полям ничего не делал. */}
              {isImage && (
                <button
                  type="button"
                  aria-label={zoomed ? t('zoomOut') : t('zoomIn')}
                  onClick={() => setZoomed((z) => !z)}
                  className={cn(
                    'absolute inset-0 z-[1]',
                    zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in',
                  )}
                />
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
            </MediaFrame>
          )}

          {/* Автор и меню — под вложением: сначала видно, ЧТО опубликовали,
              и только потом кто. Раньше шапка занимала первый экран, а картинка
              начиналась ниже неё. */}
          <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2">
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
                {t(`audience${post.audience}`)} ·{' '}
                <time dateTime={post.createdAt} title={exactDate}>
                  {relativeTime(post.createdAt, locale)}
                </time>
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

          {/* Текст поста — обычным блоком под шапкой, а не первой строкой ленты
            комментариев: у поста и у реплики разный вес, и одинаковая вёрстка
            читалась как «автор первым прокомментировал сам себя». */}
          {(post.content || post.original) && (
            <div className="flex shrink-0 flex-col gap-2 px-4 pb-3 text-sm">
              {post.title && <h2 className="text-base leading-snug font-semibold">{post.title}</h2>}
              {post.content && <Markdown source={post.content} />}

              {/* Репост: цитата первоисточника — иначе в полном просмотре не видно, что это репост */}
              {post.original && (
                <div className="mt-3 rounded-xl border-l-2 border-l-primary bg-muted/30 p-3">
                  <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Repeat2 className="size-3.5" aria-hidden />
                    <ProfileLink
                      userId={post.original.author.id}
                      className="hover:text-primary hover:underline"
                    >
                      {post.original.author.lastName} {post.original.author.firstName}
                    </ProfileLink>
                  </p>
                  {post.original.title && <p className="font-semibold">{post.original.title}</p>}
                  <Markdown source={post.original.content} />
                </div>
              )}
            </div>
          )}

          {/* Вложение — в потоке под текстом, а не отдельной колонкой. Высота
              ограничена, чтобы вертикальное фото не выдавливало комментарии за экран.
              Пост без вложения блок не рисует: раньше на его месте была заглушка-
              градиент, дословно повторявшая текст поста. */}
          <ActionsBar />

          {/* Заголовок ленты комментариев: счётчик и порядок */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
            <span className="text-sm font-semibold">
              {t('commentsCount', { count: commentCount })}
            </span>
            {commentCount > 1 && (
              <button
                type="button"
                onClick={() => setNewestFirst((v) => !v)}
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                {newestFirst ? t('sortNewest') : t('sortOldest')}
              </button>
            )}
          </div>

          {/* Пустой список ничего не подписывает: про отсутствие комментариев уже
              сказано в заголовке выше, и вторая такая же строка была дублем. */}
          <ul
            className={cn(
              'flex shrink-0 flex-col gap-4 px-4',
              (comments.isLoading || roots.length > 0) && 'py-3',
            )}
          >
            {comments.isLoading ? (
              <li className="text-xs text-muted-foreground">{t('loadingComments')}</li>
            ) : (
              roots.map((c) => {
                const replies = repliesOf(c.id)
                return (
                  <li key={c.id} className="flex flex-col gap-3">
                    {/* Одиночный комментарий (корень ветки) */}
                    <CommentRow
                      id={c.id}
                      author={c.author}
                      content={c.content}
                      createdAt={c.createdAt}
                      locale={locale}
                      canDelete={c.author.id === myId}
                      canReport={c.author.id !== myId}
                      onReply={() => startReply(c.id, c.author)}
                      onDelete={() => delCommentMut.mutate(c.id)}
                    />
                    {/* Ветка ответов: сплошная линия слева и короткий «ус» к каждому
                      ответу — видно, что реплики принадлежат одному разговору и кому
                      именно отвечают. Одной полосы для этого мало: она показывает
                      группу, но не связывает с ней конкретный ответ. */}
                    {replies.length > 0 && (
                      <div className="relative ml-4 flex flex-col gap-3 pl-6">
                        <span aria-hidden className="absolute top-0 left-0 h-full w-px bg-border" />
                        {replies.map((r) => (
                          <div key={r.id} className="relative">
                            <span
                              aria-hidden
                              // «Ус» упирается в аватар ответа: 1rem — половина его высоты.
                              className="absolute top-4 -left-6 h-px w-6 bg-border"
                            />
                            <CommentRow
                              id={r.id}
                              author={r.author}
                              content={r.content}
                              createdAt={r.createdAt}
                              locale={locale}
                              // Ответ всегда адресован автору корня ветки: вложенность
                              // на сервере одноуровневая, и без подписи «кому» лента
                              // ответов читается как разговор со стеной.
                              replyTo={c.author}
                              small
                              canDelete={r.author.id === myId}
                              canReport={r.author.id !== myId}
                              onReply={() => startReply(c.id, r.author)}
                              onDelete={() => delCommentMut.mutate(r.id)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        </div>

        {/* Кому отвечаем — отдельной строкой над полем, с отменой. */}
        {replyTarget && (
          <div className="flex items-center gap-2 border-t border-border px-4 pt-2 text-xs text-muted-foreground">
            <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t('replyingTo', { name: `${replyTarget.lastName} ${replyTarget.firstName}` })}
            </span>
            <button
              type="button"
              onClick={cancelReply}
              className="cursor-pointer font-medium hover:text-foreground"
            >
              {t('cancelReply')}
            </button>
          </div>
        )}

        {/* Ввод комментария: аватар · эмодзи · многострочное поле · «Опубликовать».
            Аватар слева, как во «ВКонтакте»: он показывает, от чьего имени уйдёт
            реплика — в общих аккаунтах это не всегда очевидно. */}
        <div
          className={cn(
            'relative flex items-end gap-2 px-4 py-2.5',
            !replyTarget && 'border-t border-border',
          )}
        >
          {me && (
            <Avatar className="size-8 shrink-0 self-center max-sm:hidden">
              {me.avatarUrl && <AvatarImage src={me.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">{initials(me)}</AvatarFallback>
            </Avatar>
          )}
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

          <MentionSuggest
            query={mention}
            onPick={(login) => {
              const el = inputRef.current
              const caret = el?.selectionStart ?? text.length
              const next = applyMention(text, caret, login)
              setText(next.text)
              setMention(null)
              requestAnimationFrame(() => {
                el?.focus()
                el?.setSelectionRange(next.caret, next.caret)
              })
            }}
          />

          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            onChange={(e) => {
              const v = e.target.value
              setText(v)
              setMention(mentionQuery(v, e.target.selectionStart ?? v.length))
              // Очистка поля режим ответа не сбрасывает: у него есть своя кнопка отмены.
            }}
            onKeyUp={(e) =>
              setMention(mentionQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))
            }
            onBlur={() => setMention(null)}
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

      {repostDialog && <RepostDialog post={post} onClose={() => setRepostDialog(false)} />}
    </>
  )
}

// Строка контента (подпись автора или комментарий), симметрично: аватар · имя+текст · мета.
/**
 * Комментарий в раскладке «ВКонтакте»: имя отдельной строкой, под ним текст, ещё ниже
 * — время и действия. Раньше имя и текст шли одной строкой, и в длинной ветке было не
 * видно, где кончается реплика одного и начинается реплика другого.
 *
 * `replyTo` — кому адресован ответ. Во вложенной ветке без этого непонятно, кому
 * отвечают: у корня может быть десяток ответов подряд.
 */
/** Кнопка панели действий: иконка и счётчик. Название — в aria-label и подсказке. */
function BarButton({
  label,
  count,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string
  count?: number
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        pressed && 'text-foreground',
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  )
}

function CommentRow({
  id,
  author,
  content,
  createdAt,
  locale,
  replyTo,
  canDelete = false,
  canReport = false,
  onReply,
  onDelete,
  small = false,
}: {
  id: string
  author: PostAuthor
  content: string
  createdAt: string
  locale: string
  replyTo?: PostAuthor | null
  canDelete?: boolean
  canReport?: boolean
  onReply?: () => void
  onDelete?: () => void
  small?: boolean
}) {
  const t = useTranslations('Feed')
  const [reporting, setReporting] = useState(false)

  return (
    <div className="group flex gap-2">
      <ProfileLink userId={author.id} className="shrink-0">
        <Avatar className={small ? 'size-7' : 'size-8'}>
          {author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
          <AvatarFallback className="text-[10px]">{initials(author)}</AvatarFallback>
        </Avatar>
      </ProfileLink>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm leading-snug">
          <ProfileLink
            userId={author.id}
            className="font-semibold hover:text-primary hover:underline"
          >
            {author.lastName} {author.firstName}
          </ProfileLink>
          {replyTo && (
            <span className="text-xs text-muted-foreground">
              · {replyTo.firstName} {replyTo.lastName}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-sm leading-snug break-words whitespace-pre-wrap">{content}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{relativeTime(createdAt, locale)}</span>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="cursor-pointer font-medium hover:text-foreground"
            >
              {t('reply')}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="cursor-pointer hover:text-foreground"
            >
              {t('report')}
            </button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            >
              {t('delete')}
            </button>
          )}
        </div>
      </div>

      {reporting && (
        <ReportModal
          targetType="COMMENT"
          targetId={id}
          preview={content}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  )
}
