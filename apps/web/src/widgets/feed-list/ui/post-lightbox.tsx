'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Eye,
  Heart,
  MessageCircle,
  Pin,
  Repeat2,
  Smile,
  X,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  addCommentRequest,
  addReactionRequest,
  canRepost,
  deleteCommentRequest,
  fetchComments,
  incrementPostView,
  postKeys,
  removeReactionRequest,
  type FeedPost,
  type PostReaction,
} from '../../../entities/post'
import { ProfileLink } from '../../../entities/user'
import { RepostDialog, useRepost } from '../../../features/repost-post'
import { ReportModal } from '../../../features/report-content'
import type { PostAuthor } from '../../../entities/post'
import { Avatar, AvatarFallback, AvatarImage, Markdown } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { relativeTime, useBackClose, useBodyScrollLock } from '../../../shared/lib'
import { SharePostMenu } from '../../../features/share-post'
import { useBookmark } from '../../../features/bookmark-post'
import { PostTileMenu } from './post-tile-menu'
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
      // Esc уже обработало окно поверх поста (пересылка, жалоба: Radix гасит событие через
      // preventDefault) — пост под ним остаётся открытым.
      if (e.defaultPrevented) return
      // Стрелки в поле комментария двигают курсор, а не листают посты: иначе набранный
      // текст пропадал вместе с переходом к соседней публикации.
      const target = e.target as HTMLElement | null
      if (
        e.key !== 'Escape' &&
        target &&
        (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
      )
        return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight' && index < posts.length - 1) onIndex(index + 1)
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-0 backdrop-blur-sm animate-in fade-in-0 duration-150 sm:px-16 sm:pt-6 sm:pb-16"
    >
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute right-3 top-3 z-30 flex size-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
      >
        <X className="size-6" aria-hidden />
      </button>

      {/* Листание постов — полосы во всю высоту экрана шириной с прежнюю кнопку: в край
          экрана попасть проще, чем в кружок, а промах закрывал пост кликом по фону.
          Боковые поля оверлея (sm:px-16) шире полосы, чтобы она не ложилась на окно.
          На телефоне окно во всю ширину — там полоса перекрыла бы пост, и кнопка
          остаётся обычной. Крестик — выше полосы (z-30), иначе она его перекрывала. */}
      {index > 0 && (
        <button
          type="button"
          aria-label={t('prevPost')}
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
          className="group absolute z-20 flex w-14 items-center justify-center max-sm:top-1/2 max-sm:h-14 max-sm:-translate-y-1/2 sm:inset-y-0 sm:w-16 left-0"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover:bg-white/20">
            <ChevronLeft className="size-6" aria-hidden />
          </span>
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
          className="group absolute z-20 flex w-14 items-center justify-center max-sm:top-1/2 max-sm:h-14 max-sm:-translate-y-1/2 sm:inset-y-0 sm:w-16 right-0"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover:bg-white/20">
            <ChevronRight className="size-6" aria-hidden />
          </span>
        </button>
      )}

      {posts.length > 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white tabular-nums backdrop-blur-sm">
          {t('counter', { current: index + 1, total: posts.length })}
        </div>
      )}

      {/* Раскладка Instagram: с md медиа слева на всю высоту окна, справа панель —
          шапка, подпись с комментариями, действия, ввод. Высота окна у поста с медиа
          фиксированная: иначе при листании карусели окно прыгало бы под размер кадра.
          У поста без вложения левой колонки нет вовсе — только панель, иначе половина
          окна пустовала бы. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex max-h-[92vh] w-full flex-col overflow-hidden bg-background shadow-2xl sm:rounded-2xl',
          post.media.length > 0
            ? 'max-w-[42rem] md:h-[min(92vh,52rem)] md:max-w-6xl'
            : 'max-w-[34rem]',
        )}
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
  // Раскрытые ветки ответов. Как в Instagram, ответы свёрнуты под «Посмотреть ответы»:
  // иначе одна бурная ветка уводила остальные комментарии за край панели.
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(new Set())
  const [emojiOpen, setEmojiOpen] = useState(false)
  // Что набрано после «@» перед курсором. null — упоминание сейчас не пишут.
  const [mention, setMention] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  // Только что отправленный комментарий: к нему прокручиваем ленту, когда он придёт
  // в перезапрошенном списке. Иначе реплика появлялась где-то за краем панели, и было
  // непонятно, ушла ли она вообще.
  const [scrollToId, setScrollToId] = useState<string | null>(null)

  // Закрытие пикера эмодзи по клику вне его области и по Esc (без закрытия при отводе мыши).
  // Меню поста закрывается само — оно живёт внутри PostTileMenu.
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (emojiRef.current && !emojiRef.current.contains(target)) setEmojiOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Esc закрывает сначала всплывающее окно, а не весь лайтбокс.
        e.preventDefault()
        e.stopPropagation()
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [emojiOpen])

  // Ответить: подставляем «@Имя » и ставим курсор после упоминания (текст печатается следом).
  // Кому отвечаем — показываем подписью над полем ввода. Раньше имя адресата
  // впечатывалось в текст реплики («@Иванов Иван …»), и оно уезжало на сервер
  // частью комментария: в ленте каждый ответ начинался с чужой фамилии.
  const [replyTarget, setReplyTarget] = useState<PostAuthor | null>(null)

  function toggleThread(rootId: string): void {
    setOpenThreads((prev) => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }

  function startReply(commentId: string, author: PostAuthor): void {
    setReplyTo(commentId)
    setReplyTarget(author)
    // Отвечающий должен видеть ветку, в которую пишет, — и свой ответ в ней после отправки.
    setOpenThreads((prev) => (prev.has(commentId) ? prev : new Set(prev).add(commentId)))
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
  const { bookmarked, toggle: toggleBookmark } = useBookmark(post.id, post.bookmarked)

  const comments = useQuery({
    queryKey: postKeys.comments(post.id),
    queryFn: () => fetchComments(post.id),
  })

  const addMut = useMutation({
    mutationFn: () =>
      addCommentRequest(post.id, { content: text.trim(), parentId: replyTo ?? undefined }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: postKeys.comments(post.id) })
      void qc.invalidateQueries({ queryKey: postKeys.all })
      setScrollToId(created.id)
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

  // Прокрутка к отправленному комментарию — после того как список с ним отрисован.
  // `block: 'nearest'`: если реплика уже видна, лента не дёргается.
  useEffect(() => {
    if (!scrollToId) return
    const el = threadRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(scrollToId)}"]`,
    )
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setScrollToId(null)
  }, [scrollToId, comments.data])

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

  const hasCaption = Boolean(post.title || post.content || post.original)

  // Порядок блоков на телефоне задаётся через `order`: правая колонка там — `contents`,
  // её части встают в общий столбец как в мобильном Instagram: шапка, медиа, действия,
  // подпись с комментариями, ввод. С md — две колонки, и порядок снова DOM-овый.
  return (
    <>
      <div
        className={cn(
          'sh-scroll flex min-h-0 flex-1 flex-col bg-background max-md:overflow-y-auto',
          cur && 'md:flex-row',
        )}
      >
        {cur && (
          <MediaFrame
            postId={post.id}
            media={cur}
            // На телефоне высота кадра фиксированная, а не «по картинке»: в карусели соседние
            // снимки бывают то горизонтальными, то вертикальными, и при height:auto всё под
            // кадром прыгало бы на каждом переключении. С md кадр — левая колонка во всю
            // высоту окна. Размытая подложка заполняет поля, поэтому пустоты не видно.
            className="h-[45vh] shrink-0 bg-black max-md:order-2 sm:h-[60vh] md:h-full md:min-w-0 md:flex-1"
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
                {/* Зона нажатия — вся высота кадра и полоса шире самого кружка: в галерее
                    целятся не в иконку, а «в правый край». Кружок прежнего размера. */}
                {mi > 0 && (
                  <button
                    type="button"
                    aria-label={t('prev')}
                    onClick={() => {
                      setMi(mi - 1)
                      setZoomed(false)
                    }}
                    className="group absolute inset-y-0 left-0 z-10 flex w-14 items-center justify-start pl-2 sm:w-20 sm:pl-3"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-white/85 text-neutral-900 shadow transition-colors group-hover:bg-white">
                      <ChevronLeft className="size-5" aria-hidden />
                    </span>
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
                    className="group absolute inset-y-0 right-0 z-10 flex w-14 items-center justify-end pr-2 sm:w-20 sm:pr-3"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-white/85 text-neutral-900 shadow transition-colors group-hover:bg-white">
                      <ChevronRight className="size-5" aria-hidden />
                    </span>
                  </button>
                )}
                {/* Номер материала: «2 из 8» */}
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white tabular-nums">
                  {t('counter', { current: mi + 1, total: media.length })}
                </div>
                <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">
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

        {/* Правая панель. На телефоне — `contents`: см. комментарий над return. */}
        <div
          className={cn(
            'flex flex-col max-md:contents md:min-h-0',
            cur
              ? 'md:w-[22rem] md:shrink-0 md:border-l md:border-border lg:w-[26rem] xl:w-[30rem]'
              : 'md:flex-1',
          )}
        >
          <header className="flex shrink-0 items-center gap-3 px-4 py-3 max-md:order-1 md:border-b md:border-border">
            <ProfileLink userId={post.author.id} className="shrink-0">
              <Avatar className="size-8">
                {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt="" />}
                <AvatarFallback className="text-[10px]">{initials(post.author)}</AvatarFallback>
              </Avatar>
            </ProfileLink>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">
                <ProfileLink userId={post.author.id} className="hover:opacity-70">
                  {post.author.lastName} {post.author.firstName}
                </ProfileLink>
              </p>
              {/* Аудитория — единственное, чего нет в Instagram, но без неё не понять,
                  кому виден пост. Время — под подписью и в строке под лайками. */}
              <p className="truncate text-xs text-muted-foreground">
                {t(`audience${post.audience}`)}
              </p>
            </div>
            {post.pinnedAt && <Pin className="size-4 shrink-0 text-primary" aria-hidden />}
            {/* Одно меню на пост: то же, что на карточке и плитке. */}
            <PostTileMenu
              post={post}
              canModerate={canModerate}
              canDelete={canDelete}
              isMine={post.authorId === myId}
              onDeleted={onClose}
            />
          </header>

          {/* Подпись и комментарии — одна прокручиваемая лента, как в Instagram: подпись
              первой строкой с аватаром автора, дальше реплики. */}
          <div
            ref={threadRef}
            className="sh-scroll flex flex-col gap-4 px-4 py-3 max-md:order-4 max-md:shrink-0 md:min-h-0 md:flex-1 md:overflow-y-auto"
          >
            {hasCaption && (
              <div className="flex gap-3">
                <ProfileLink userId={post.author.id} className="shrink-0">
                  <Avatar className="size-8">
                    {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt="" />}
                    <AvatarFallback className="text-[10px]">{initials(post.author)}</AvatarFallback>
                  </Avatar>
                </ProfileLink>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <p className="leading-snug">
                    <ProfileLink userId={post.author.id} className="font-semibold hover:opacity-70">
                      {post.author.lastName} {post.author.firstName}
                    </ProfileLink>
                    {post.title && <span className="ml-1.5 font-semibold">{post.title}</span>}
                  </p>
                  {post.content && <Markdown source={post.content} />}

                  {/* Репост: цитата первоисточника — иначе в полном просмотре не видно,
                      что это репост */}
                  {post.original && (
                    <div className="mt-1 rounded-xl border-l-2 border-l-primary bg-muted/30 p-3">
                      <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Repeat2 className="size-3.5" aria-hidden />
                        <ProfileLink
                          userId={post.original.author.id}
                          className="hover:text-primary hover:underline"
                        >
                          {post.original.author.lastName} {post.original.author.firstName}
                        </ProfileLink>
                      </p>
                      {post.original.title && (
                        <p className="font-semibold">{post.original.title}</p>
                      )}
                      <Markdown source={post.original.content} />
                    </div>
                  )}
                  <time
                    dateTime={post.createdAt}
                    title={exactDate}
                    className="text-xs text-muted-foreground"
                  >
                    {relativeTime(post.createdAt, locale)}
                  </time>
                </div>
              </div>
            )}

            {/* Порядок ленты комментариев. Своего ранжирования у нас нет, поэтому честные
                «сначала новые / сначала старые», а не «сначала интересные». */}
            {commentCount > 1 && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{t('commentsCount', { count: commentCount })}</span>
                <button
                  type="button"
                  onClick={() => setNewestFirst((v) => !v)}
                  className="cursor-pointer hover:text-foreground"
                >
                  {newestFirst ? t('sortNewest') : t('sortOldest')}
                </button>
              </div>
            )}

            {/* Пустой список ничего не подписывает: счётчик уже под лайками. */}
            {comments.isLoading ? (
              <p className="text-xs text-muted-foreground">{t('loadingComments')}</p>
            ) : (
              roots.length > 0 && (
                <ul className="flex flex-col gap-4">
                  {roots.map((c) => {
                    const replies = repliesOf(c.id)
                    const open = openThreads.has(c.id)
                    return (
                      <li key={c.id} className="flex flex-col gap-3">
                        <CommentRow
                          id={c.id}
                          author={c.author}
                          content={c.content}
                          createdAt={c.createdAt}
                          locale={locale}
                          isPostAuthor={c.author.id === post.author.id}
                          canDelete={c.author.id === myId}
                          canReport={c.author.id !== myId}
                          onReply={() => startReply(c.id, c.author)}
                          onDelete={() => delCommentMut.mutate(c.id)}
                        />
                        {/* Ветка ответов — со сдвигом под текст корня, свёрнута под
                            «—— Посмотреть ответы (N)», как в Instagram. */}
                        {replies.length > 0 && (
                          <div className="ml-11 flex flex-col gap-3">
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => toggleThread(c.id)}
                              className="flex cursor-pointer items-center gap-3 self-start text-xs font-semibold text-muted-foreground hover:text-foreground"
                            >
                              <span aria-hidden className="h-px w-6 bg-muted-foreground/50" />
                              {open
                                ? t('hideReplies')
                                : t('viewReplies', { count: replies.length })}
                            </button>
                            {open &&
                              replies.map((r) => (
                                <CommentRow
                                  key={r.id}
                                  id={r.id}
                                  author={r.author}
                                  content={r.content}
                                  createdAt={r.createdAt}
                                  locale={locale}
                                  // Ответ всегда адресован автору корня ветки: вложенность на
                                  // сервере одноуровневая, и без подписи «кому» ветка
                                  // читается как разговор со стеной.
                                  replyTo={c.author}
                                  isPostAuthor={r.author.id === post.author.id}
                                  small
                                  canDelete={r.author.id === myId}
                                  canReport={r.author.id !== myId}
                                  onReply={() => startReply(c.id, r.author)}
                                  onDelete={() => delCommentMut.mutate(r.id)}
                                />
                              ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            )}
          </div>

          {/* Действия, как в Instagram: иконки без подписей и счётчиков, закладка справа;
              под ними число отметок и дата. На телефоне — сразу под медиа. */}
          <div className="shrink-0 px-2 pt-1.5 pb-3 max-md:order-3 md:border-t md:border-border">
            <div className="flex items-center text-foreground">
              <BarButton label={t('like')} pressed={liked} onClick={toggleLike}>
                <Heart
                  className={cn('size-6', liked && 'fill-destructive text-destructive')}
                  aria-hidden
                />
              </BarButton>
              <BarButton label={t('comment')} onClick={() => inputRef.current?.focus()}>
                <MessageCircle className="size-6 -scale-x-100" aria-hidden />
              </BarButton>
              {showRepost && (
                <BarButton
                  label={t('repost')}
                  disabled={repostPending}
                  onClick={() => (repostAudience ? repost(post.id) : setRepostDialog(true))}
                >
                  <Repeat2 className="size-6" aria-hidden />
                </BarButton>
              )}
              <SharePostMenu
                postId={post.id}
                className="flex size-10 cursor-pointer items-center justify-center rounded-full transition-opacity hover:opacity-60 [&_svg]:size-6"
              />
              {/* Избранное — справа, отдельно от реакций: личная полка, а не вовлечение. */}
              <div className="ml-auto">
                <BarButton label={t('bookmark')} pressed={bookmarked} onClick={toggleBookmark}>
                  <Bookmark className={cn('size-6', bookmarked && 'fill-current')} aria-hidden />
                </BarButton>
              </div>
            </div>
            <p className="px-2 text-sm font-semibold">
              {t('likesCount', { count: reactions.length })}
            </p>
            <p className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
              <time dateTime={post.createdAt}>{exactDate}</time>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1" title={t('viewsCount', { count: views })}>
                <Eye className="size-3.5" aria-hidden />
                {views}
              </span>
            </p>
          </div>

          {/* Поле ввода. На телефоне — прилипает к низу общего скролла, чтобы не искать
              его под длинной лентой комментариев. */}
          <div className="shrink-0 border-t border-border bg-background max-md:sticky max-md:bottom-0 max-md:order-5">
            {/* Кому отвечаем — отдельной строкой над полем, с отменой. */}
            {replyTarget && (
              <div className="flex items-center gap-2 px-4 pt-2 text-xs text-muted-foreground">
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

            {/* Ввод комментария: эмодзи · многострочное поле · «Опубликовать», как в
                Instagram. Всё выровнено по нижней кромке (`items-end` + `self-end`): поле
                растёт вверх, и при центрировании кнопки повисали бы посреди поля. */}
            <div className="relative flex items-end gap-2 px-4 py-2.5">
              {/* Пикер эмодзи */}
              <div ref={emojiRef} className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('emoji')}
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((o) => !o)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full text-foreground transition-opacity hover:opacity-60',
                    emojiOpen && 'opacity-60',
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
                  setMention(
                    mentionQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0),
                  )
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
                className="max-h-28 min-h-8 min-w-0 flex-1 resize-none self-end bg-transparent py-1.5 text-sm leading-snug outline-none placeholder:text-muted-foreground"
              />

              <button
                type="button"
                onClick={() => addMut.mutate()}
                disabled={text.trim().length === 0 || addMut.isPending}
                className="flex h-8 shrink-0 items-center self-end text-sm font-semibold text-primary transition-opacity hover:opacity-70 disabled:opacity-40"
              >
                {t('publish')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {repostDialog && <RepostDialog post={post} onClose={() => setRepostDialog(false)} />}
    </>
  )
}

/** Кнопка панели действий: только иконка, как в Instagram. Название — в aria-label и подсказке. */
function BarButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string
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
      className="flex size-10 cursor-pointer items-center justify-center rounded-full transition-opacity hover:opacity-60 disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}

/**
 * Комментарий в раскладке Instagram: имя жирным и текст одной строкой, под ними время и
 * действия. `replyTo` — кому адресован ответ: у корня может быть десяток ответов подряд,
 * и без адресата не понять, кому отвечают.
 */
function CommentRow({
  id,
  author,
  content,
  createdAt,
  locale,
  replyTo,
  isPostAuthor = false,
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
  /** Комментарий оставил сам автор поста — рядом с именем встаёт метка. */
  isPostAuthor?: boolean
  canDelete?: boolean
  canReport?: boolean
  onReply?: () => void
  onDelete?: () => void
  small?: boolean
}) {
  const t = useTranslations('Feed')
  const [reporting, setReporting] = useState(false)

  return (
    <div
      data-comment-id={id}
      // На телефоне поле ввода прилипает к низу скролла — отступ, чтобы прокрутка к
      // новой реплике не прятала её под ним.
      className="group flex gap-3 max-md:scroll-mb-20"
    >
      <ProfileLink userId={author.id} className="shrink-0">
        <Avatar className={small ? 'size-6' : 'size-8'}>
          {author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
          <AvatarFallback className="text-[10px]">{initials(author)}</AvatarFallback>
        </Avatar>
      </ProfileLink>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug break-words whitespace-pre-wrap">
          <ProfileLink userId={author.id} className="font-semibold hover:opacity-70">
            {author.lastName} {author.firstName}
          </ProfileLink>
          {/* Метка автора: в чужой ветке важно видеть, где ответил сам публикатор, а
              где такой же читатель. Статусной парой (§2.2), а не своим цветом. */}
          {isPostAuthor && (
            <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-px align-middle text-[11px] font-medium text-primary">
              {t('commentAuthorTag')}
            </span>
          )}{' '}
          {replyTo && (
            <span className="text-primary">
              @{replyTo.firstName} {replyTo.lastName}{' '}
            </span>
          )}
          {content}
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{relativeTime(createdAt, locale)}</span>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="cursor-pointer font-semibold hover:text-foreground"
            >
              {t('reply')}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100"
            >
              {t('report')}
            </button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 max-md:opacity-100"
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
