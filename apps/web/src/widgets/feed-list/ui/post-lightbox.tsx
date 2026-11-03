'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  Repeat2,
  Smile,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { canFileComplaint } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import {
  LIKE_EMOJI,
  addCommentRequest,
  addReactionRequest,
  canRepost,
  deleteCommentRequest,
  fetchCommentsPage,
  hasMyReaction,
  incrementPostView,
  inlineMediaLink,
  patchCachedPost,
  postKeys,
  reactionSummaryOf,
  reactionTotal,
  removeReactionRequest,
  withMyReaction,
  type FeedPost,
  type PostComment,
  type PostCommentsPage,
  type PostMedia,
  type PostReactionSummary,
} from '../../../entities/post'
import { ProfileLink } from '../../../entities/user'
import { RepostDialog, useRepost } from '../../../features/repost-post'
import { ReportModal } from '../../../features/report-content'
import type { PostAuthor } from '../../../entities/post'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Markdown,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  relativeTime,
  srcSetOf,
  toApiError,
  useBackClose,
  useBodyScrollLock,
} from '../../../shared/lib'
import { SharePostMenu } from '../../../features/share-post'
import { useBookmark } from '../../../features/bookmark-post'
import { PostTileMenu } from './post-tile-menu'
import { PostByline, initials } from './post-byline'
import { MediaFrame } from './media-frame'
import { RepostBanner, RepostUnavailable } from './repost-banner'
import { useRepostSource } from '../lib/use-repost-source'
import { useMediaZoom } from '../lib/use-media-zoom'
import { MentionSuggest, applyMention, mentionQuery } from './mention-suggest'
import { CommentText } from './comment-text'

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

// Кадр в полном просмотре: на телефоне — во всю ширину, с md — левая колонка окна.
const LIGHTBOX_SIZES = '(max-width: 768px) 100vw, 70vw'

/**
 * Черновики комментариев по постам — в памяти вкладки. Случайно закрытое окно не съедает
 * набранное: открыли пост снова — текст на месте. В хранилище браузера не пишем: черновик
 * нужен на минуты, а не между сессиями.
 */
const drafts = new Map<string, string>()

// Комментарий длиннее — свёрнут до нескольких строк под «Читать далее».
const LONG_COMMENT_CHARS = 420
// Ряды скелетона, пока грузится обсуждение: место под список держится заранее.
const COMMENT_SKELETON_ROWS = 3

const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

/**
 * Счётчик комментариев поста во всех закэшированных лентах (главная, профиль, страница
 * поста) — правкой кэша, без перезапроса. Раньше после отправки сбрасывался весь
 * `['posts']`, а под ним лежат и ссылки на медиа: картинки в окне получали новые адреса
 * и перерисовывались, лента за окном перезагружалась целиком — всё дёргалось.
 */
function patchCommentCount(qc: QueryClient, postId: string, delta: number): void {
  patchCachedPost(qc, postId, (p) => ({
    ...p,
    _count: { ...p._count, comments: Math.max(0, p._count.comments + delta) },
  }))
}

interface LightboxProps {
  posts: FeedPost[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  // Открыть с фокусом на поле комментария (клик по иконке комментария в плитке профиля).
  focusComment?: boolean
  /** С какого вложения открыть пост — с той плитки коллажа, по которой кликнули. */
  initialMedia?: number
}

// Лайтбокс поста (Instagram-стиль): медиа/обложка слева, детали и комментарии справа.
// Внешние стрелки листают посты в наборе; карусель внутри — медиа текущего поста.
export function PostLightbox({
  posts,
  index,
  onIndex,
  onClose,
  focusComment = false,
  initialMedia = 0,
}: LightboxProps) {
  const t = useTranslations('Feed')
  // Второй аргумент — запрет выделения на всей странице: оверлей перетаскивают,
  // и без него браузер выделяет текст, лежащий ПОД ним (см. хук).
  useBodyScrollLock(true, true)
  useBackClose(onClose)
  // Репост открывается исходным постом, как в Instagram (useRepostSource). Хук — до ранних
  // выходов: порядок хуков один на каждую отрисовку.
  const source = useRepostSource(posts[index])
  const windowRef = useRef<HTMLDivElement>(null)
  // Номер вложения относится к посту, который открыли; соседние посты — с первого кадра.
  const openedIndex = useRef(index)

  // Фокус — внутрь окна при открытии и обратно на то, что его открыло, при закрытии:
  // иначе после закрытия клавиатура оказывалась в начале страницы.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!focusComment) windowRef.current?.focus({ preventScroll: true })
    return () => opener?.focus({ preventScroll: true })
    // Только на открытие: листание постов не возвращает фокус.
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Tab не уходит под оверлей: с последнего элемента окна — на первый и обратно.
      // Окна поверх поста (меню, жалоба) живут в своих порталах и держат фокус сами.
      if (e.key === 'Tab') {
        const root = windowRef.current?.parentElement
        if (!root || !root.contains(document.activeElement)) return
        const focusable = [
          ...root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => el.offsetParent !== null)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === windowRef.current)
        ) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
        return
      }
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
  // Что показано: исходник репоста, если он загрузился, иначе сам пост (или репост с
  // цитатой, когда исходник зрителю не виден). Пока грузится — скелетон панели.
  const shown = source.kind === 'ready' ? source.source : post
  const repost = source.kind === 'ready' ? post : undefined
  const withMedia = shown.media.length > 0
  const mediaWidth = lightboxWidthFor(shown.media)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${t('postTitle')} · ${post.author.lastName} ${post.author.firstName}`}
      onClick={onClose}
      // Нижнее поле — под счётчик «2 из 8»; у одиночного поста его нет, и поле не нужно.
      className={cn(
        // Без backdrop-blur: под 85% чёрного он не виден, а его пересчёт по всей странице в
        // каждом кадре проявления давал рывок при открытии.
        // Низ — над экранной клавиатурой (`--kb-inset`, providers.tsx): на iOS она накрывала
        // поле комментария, и писать приходилось вслепую.
        'fixed inset-x-0 top-0 bottom-[var(--kb-inset,0px)] z-[100] flex items-center justify-center bg-black/85 p-0 animate-in fade-in-0 duration-200 sm:px-16 sm:pt-6',
        posts.length > 1 ? 'sm:pb-16' : 'sm:pb-6',
      )}
    >
      {/* Листание постов — полосы во всю высоту экрана шириной с прежнюю кнопку: в край
          экрана попасть проще, чем в кружок, а промах закрывал пост кликом по фону.
          Боковые поля оверлея (sm:px-16) шире полосы, чтобы она не ложилась на окно.
          На телефоне окно во всю ширину, и кнопки по краям экрана ложились прямо на снимок
          — рядом со стрелками карусели, и листание постов путали с листанием кадров. Там
          посты листают парой стрелок в шапке окна (PostView, `onPrev`/`onNext`). */}
      {index > 0 && (
        <button
          type="button"
          aria-label={t('prevPost')}
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
          title={t('prevPost')}
          className="group absolute inset-y-0 left-0 z-20 hidden w-16 items-center justify-center outline-none sm:flex"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 group-hover:bg-white/20 group-focus-visible:ring-2 group-focus-visible:ring-white/70">
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
          title={t('nextPost')}
          className="group absolute inset-y-0 right-0 z-20 hidden w-16 items-center justify-center outline-none sm:flex"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 group-hover:bg-white/20 group-focus-visible:ring-2 group-focus-visible:ring-white/70">
            <ChevronRight className="size-6" aria-hidden />
          </span>
        </button>
      )}

      {posts.length > 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 hidden -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white tabular-nums backdrop-blur-sm sm:block">
          {t('counter', { current: index + 1, total: posts.length })}
        </div>
      )}

      {/* Две раскладки.

          С медиа — просмотрщик: с md кадр слева, справа панель (20–26rem) — шапка, подпись с
          комментариями, действия, ввод. Окно до 1440px × 92dvh; ширина подогнана под самое
          широкое вложение поста (`--lightbox-w`): вертикальное фото больше не стоит посреди
          широкого окна с размытыми полями в треть экрана. Подгонка — по всему посту, а не по
          кадру: при листании карусели окно не прыгает. На телефоне — весь экран.

          Без медиа — компактное окно до 45rem: высота по содержимому, не выше 85dvh, дальше
          внутренняя прокрутка. Раньше и короткий текст открывался окном во всю высоту
          экрана, и под тремя строками стояла пустота. */}
      <div
        ref={windowRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={mediaWidth ? ({ '--lightbox-w': mediaWidth } as CSSProperties) : undefined}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl outline-none sm:rounded-[1.25rem]',
          'animate-in fade-in-0 zoom-in-[0.98] duration-200 motion-reduce:animate-none',
          withMedia
            ? 'max-w-[42rem] md:max-h-[92dvh] md:max-w-[min(1440px,var(--lightbox-w,1440px))]'
            : 'max-w-[45rem] sm:h-auto sm:max-h-[85dvh]',
        )}
      >
        {source.kind === 'loading' ? (
          // Пока грузится исходник репоста — заготовка той же раскладки: шапка с крестиком
          // (закрыть окно можно и в этот момент), под ней место кадра или текста.
          <div className="flex flex-1 flex-col" aria-hidden>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <CloseButton label={t('close')} onClick={onClose} />
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="min-h-40 w-full flex-1" />
            </div>
          </div>
        ) : (
          <PostView
            key={`${post.id}:${shown.id}`}
            post={shown}
            via={repost}
            originalUnavailable={source.kind === 'unavailable'}
            onClose={onClose}
            onPrev={index > 0 ? () => onIndex(index - 1) : undefined}
            onNext={index < posts.length - 1 ? () => onIndex(index + 1) : undefined}
            focusComment={focusComment}
            initialMedia={index === openedIndex.current ? initialMedia : 0}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}

// Содержимое одного поста в лайтбоксе. Ремонтируется по key={post.id} — состояние
// (карусель, реакции, ввод) сбрасывается при переходе к другому посту.
function PostView({
  post,
  via,
  originalUnavailable = false,
  onClose,
  onPrev,
  onNext,
  focusComment = false,
  initialMedia = 0,
}: {
  post: FeedPost
  /** Репост, через который открыт `post` (исходник): его пометка сверху и его меню. */
  via?: FeedPost
  /** `post` — репост, чей исходник зрителю недоступен (удалён или чужой аудитории). */
  originalUnavailable?: boolean
  onClose: () => void
  /** Соседние посты набора — для стрелок в шапке на телефоне (на десктопе они по краям экрана). */
  onPrev?: () => void
  onNext?: () => void
  focusComment?: boolean
  initialMedia?: number
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const me = useAppSelector((s) => s.auth.user)
  const myId = me?.id
  const myRole = useAppSelector((s) => s.auth.role)
  // Жалобу сервер принимает не от всех ролей (COMPLAINT_REPORTER_ROLES) — пункт по роли.
  const canReportComments = canFileComplaint(myRole)

  const [mi, setMi] = useState(() =>
    Math.min(Math.max(0, initialMedia), Math.max(0, post.media.length - 1)),
  )
  const zoom = useMediaZoom(mi)
  const [views, setViews] = useState(post.views)
  const [reactions, setReactions] = useState(() => reactionSummaryOf(post, myId))
  // Сводка — из кэша постов: лайк в карточке ленты приходит сюда правкой кэша.
  useEffect(() => setReactions(reactionSummaryOf(post, myId)), [post, myId])

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
  // Черновик переживает закрытие окна (см. `drafts`).
  const [text, setTextState] = useState(() => drafts.get(post.id) ?? '')
  const setText = (next: string | ((prev: string) => string)): void => {
    setTextState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      if (value) drafts.set(post.id, value)
      else drafts.delete(post.id)
      return value
    })
  }
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
  // Только что отправленная реплика проявляется, а не возникает рывком (см. CommentRow).
  const [freshId, setFreshId] = useState<string | null>(null)

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

  // Стрелки клавиатуры листают сначала кадры поста, а на краю карусели — посты (их
  // обрабатывает окно: событие отмечено preventDefault только когда кадр сменился здесь).
  // Esc при увеличенном кадре сначала возвращает масштаб, а не закрывает окно.
  const mediaCount = post.media.length
  const { zoomed, reset: resetZoom } = zoom
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(TEXTAREA|INPUT|SELECT)$/.test(target.tagName)))
        return
      if (e.key === 'Escape' && zoomed) {
        e.preventDefault()
        resetZoom()
      } else if (e.key === 'ArrowRight' && mi < mediaCount - 1) {
        e.preventDefault()
        setMi(mi + 1)
      } else if (e.key === 'ArrowLeft' && mi > 0) {
        e.preventDefault()
        setMi(mi - 1)
      }
    }
    // Перехват (capture): слушатель окна листает посты и обязан узнать, что кадр уже
    // сменился здесь, — а этот эффект переподписывается на каждом кадре и в обычной
    // фазе встал бы в очередь после него.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mi, mediaCount, zoomed, resetZoom])

  // Соседние снимки карусели греем заранее с тем же srcset и sizes, что у кадра: браузер
  // выберет ту же копию, и переход покажет её из кэша, без мигания пустого кадра.
  useEffect(() => {
    for (const m of [post.media[mi - 1], post.media[mi + 1]]) {
      if (!m || m.mime.startsWith('video/')) continue
      const link = inlineMediaLink(m)
      if (!link) continue
      const img = new Image()
      const srcset =
        m.mime === 'image/gif'
          ? undefined
          : srcSetOf(link.sources, { url: link.url, width: m.width })
      if (srcset) {
        img.sizes = LIGHTBOX_SIZES
        img.srcset = srcset
      }
      img.src = link.url
    }
  }, [mi, post.media])

  const byRole = myRole !== null && MODERATOR_ROLES.includes(myRole)
  // Меню — про публикацию, которую открыли: у репоста это сам репост (удалить его), а не
  // чужой исходник. Лайки, комментарии и просмотры при этом — исходника, как в Instagram.
  const menuPost = via ?? post
  // Права считает сервер (ранг относительно автора и scope); роль — только для старого API.
  const canModerate = menuPost.canPin ?? byRole
  const canDelete = menuPost.canDelete ?? (menuPost.authorId === myId || byRole)
  // Репост репоста ссылается на исходник — а он зрителю недоступен, сервер откажет.
  const showRepost = !originalUnavailable && canRepost(myRole, post)
  const liked = hasMyReaction(reactions, LIKE_EMOJI)
  const { bookmarked, toggle: toggleBookmark } = useBookmark(post.id, post.bookmarked)

  // Обсуждение — страницами свежих сверху: раньше приходили первые двести, и в длинной
  // ветке новые реплики не видел никто. Более ранние — по «Показать предыдущие».
  const comments = useInfiniteQuery({
    queryKey: postKeys.comments(post.id),
    queryFn: ({ pageParam }) => fetchCommentsPage(post.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })

  // Правка кэша обсуждения: первая страница — самые свежие, `total` живёт в ней же.
  function patchComments(edit: (pages: PostCommentsPage[]) => PostCommentsPage[]): void {
    qc.setQueryData<InfiniteData<PostCommentsPage>>(postKeys.comments(post.id), (old) =>
      old ? { ...old, pages: edit(old.pages) } : old,
    )
  }
  const shiftTotal = (page: PostCommentsPage, delta: number): PostCommentsPage =>
    page.total === undefined ? page : { ...page, total: Math.max(0, page.total + delta) }

  const addMut = useMutation({
    mutationFn: () =>
      addCommentRequest(post.id, { content: text.trim(), parentId: replyTo ?? undefined }),
    // Сервер вернул созданную реплику целиком — дописываем её в список сами, без
    // перезапроса: окно не перерисовывается, появляется ровно одна новая строка.
    onSuccess: (created) => {
      patchComments((pages) =>
        pages.map((page, i) =>
          i === 0 ? shiftTotal({ ...page, items: [created, ...page.items] }, 1) : page,
        ),
      )
      patchCommentCount(qc, post.id, 1)
      setScrollToId(created.id)
      setFreshId(created.id)
      setText('')
      cancelReply()
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Отправка комментария — не чаще одной за раз. isPending мутации приходит в рендер не сразу, и второй
  // быстрый Enter (или автоповтор клавиши) успевал отправить тот же комментарий ещё раз.
  const sendingRef = useRef(false)
  function send(): void {
    if (sendingRef.current || text.trim().length === 0) return
    sendingRef.current = true
    addMut.mutate(undefined, {
      onSettled: () => {
        sendingRef.current = false
      },
    })
  }

  const delCommentMut = useMutation({
    mutationFn: (commentId: string) => deleteCommentRequest(post.id, commentId),
    // Ответы удалённого остаются (они всплывают корнями, см. `roots`) — убираем одну строку.
    onSuccess: (_, commentId) => {
      patchComments((pages) =>
        pages.map((page, i) => {
          const items = page.items.filter((c) => c.id !== commentId)
          return i === 0 ? shiftTotal({ ...page, items }, -1) : { ...page, items }
        }),
      )
      patchCommentCount(qc, post.id, -1)
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Удалить комментарий: свой — сразу; чужой (автор поста под своим постом, модерация) —
  // с подтверждением: это решение о чужом тексте.
  function canDeleteComment(c: PostComment): boolean {
    return c.canDelete ?? (c.author.id === myId || post.authorId === myId)
  }
  function removeComment(c: PostComment): void {
    if (c.author.id === myId) {
      delCommentMut.mutate(c.id)
      return
    }
    void confirm({
      title: t('commentDeleteConfirm'),
      description: t('commentDeleteHint'),
      confirmLabel: t('delete'),
      destructive: true,
    }).then((ok) => {
      if (ok) delCommentMut.mutate(c.id)
    })
  }

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

  // Оптимистичный лайк ❤️ с откатом (docs/FRONTEND_RULES.md §5.5) — и в кэше постов, чтобы
  // карточка того же поста в ленте за окном показывала тот же лайк.
  function toggleLike(): void {
    if (!myId) return
    const prev = reactions
    const apply = (summary: PostReactionSummary[]): void => {
      setReactions(summary)
      patchCachedPost(qc, post.id, (p) => ({ ...p, reactionSummary: summary }))
    }
    apply(withMyReaction(prev, LIKE_EMOJI, !liked))
    const request = liked ? removeReactionRequest : addReactionRequest
    request(post.id, LIKE_EMOJI).catch((e: unknown) => {
      apply(prev)
      toast.error(tErr(toApiError(e).code))
    })
  }

  const media = post.media
  const cur = media[mi]
  const isImage = cur ? !cur.mime.startsWith('video/') : false
  // Заголовок — из общего числа на сервере, а не по длине загруженного: страниц может быть
  // догружено сколько угодно, а «20 комментариев» над обсуждением в сотню вводило в заблуждение.
  const commentCount = comments.data?.pages[0]?.total ?? post._count.comments
  // Страницы идут от свежих к ранним; в окне — по порядку написания, без повторов (новая
  // реплика дописывается в первую страницу и не должна задвоиться при догрузке).
  const loaded = [
    ...new Map(
      (comments.data?.pages ?? []).flatMap((page) => page.items).map((c) => [c.id, c]),
    ).values(),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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
  // Более ранние комментарии догружаются по нажатию — в окне обсуждения прокрутка своя, и
  // догрузка сверху от прокрутки сдвигала бы читаемую реплику.
  const earlierButton = comments.hasNextPage && (
    <button
      type="button"
      onClick={() => void comments.fetchNextPage()}
      disabled={comments.isFetchingNextPage}
      className="flex cursor-pointer items-center gap-3 self-start text-xs font-semibold text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-60"
    >
      <span aria-hidden className="h-px w-6 bg-muted-foreground/50" />
      {comments.isFetchingNextPage ? t('loadingComments') : t('showEarlierComments')}
    </button>
  )

  const hasCaption = Boolean(post.title || post.content || originalUnavailable)

  // Порядок блоков на телефоне задаётся через `order`: правая колонка там — `contents`,
  // её части встают в общий столбец как в мобильном Instagram: шапка, медиа, действия,
  // подпись с комментариями, ввод. С md — две колонки, и порядок снова DOM-овый. Без
  // медиа порядок DOM-овый и на телефоне: шапка, текст, действия, ввод.
  return (
    <>
      <div
        className={cn(
          'sh-scroll flex min-h-0 flex-auto flex-col bg-background max-md:overflow-y-auto',
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
            className="h-[45dvh] shrink-0 bg-black max-md:order-2 sm:h-[60dvh] md:h-full md:min-w-0 md:flex-1"
            controls={!isImage}
            sizes={LIGHTBOX_SIZES}
            // Подложка приглушённая: в полном просмотре кадр — единственный центр внимания.
            backdropClassName="brightness-[0.45] saturate-[0.7]"
            imageClassName="max-h-full"
            {...(isImage ? { stageRef: zoom.stageRef, stageStyle: zoom.stageStyle } : {})}
          >
            {/* Слой жестов над снимком: двойной клик — приближение в точку, перетаскивание —
                сдвиг увеличенного кадра. Одиночный клик ничего не делает: им промахиваются
                мимо стрелок, и раньше он неожиданно увеличивал снимок. */}
            {isImage && (
              <div
                aria-hidden
                {...zoom.handlers}
                className={cn(
                  'absolute inset-0 z-[1] touch-none select-none',
                  zoom.zoomed
                    ? zoom.dragging
                      ? 'cursor-grabbing'
                      : 'cursor-grab'
                    : 'cursor-zoom-in',
                )}
              />
            )}
            {isImage && (
              <button
                type="button"
                aria-label={zoom.zoomed ? t('zoomOut') : t('zoomIn')}
                aria-pressed={zoom.zoomed}
                title={zoom.zoomed ? t('zoomOut') : t('zoomIn')}
                onClick={() => zoom.toggle()}
                className="absolute bottom-3 left-3 z-10 flex size-9 items-center justify-center rounded-full bg-black/55 text-white transition-colors duration-150 hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                {zoom.zoomed ? (
                  <ZoomOut className="size-4" aria-hidden />
                ) : (
                  <ZoomIn className="size-4" aria-hidden />
                )}
              </button>
            )}
            {media.length > 1 && (
              <>
                {/* Зона нажатия — вся высота кадра и полоса шире самого кружка: в галерее
                    целятся не в иконку, а «в правый край». Кружок прежнего размера. */}
                {mi > 0 && (
                  <button
                    type="button"
                    aria-label={t('prev')}
                    onClick={() => setMi(mi - 1)}
                    className="group absolute inset-y-0 left-0 z-10 flex w-14 items-center justify-start pl-2 sm:w-20 sm:pl-3"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full bg-white/85 text-neutral-900 shadow transition-colors duration-150 group-hover:bg-white group-focus-visible:ring-2 group-focus-visible:ring-white">
                      <ChevronLeft className="size-5" aria-hidden />
                    </span>
                  </button>
                )}
                {mi < media.length - 1 && (
                  <button
                    type="button"
                    aria-label={t('next')}
                    onClick={() => setMi(mi + 1)}
                    className="group absolute inset-y-0 right-0 z-10 flex w-14 items-center justify-end pr-2 sm:w-20 sm:pr-3"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full bg-white/85 text-neutral-900 shadow transition-colors duration-150 group-hover:bg-white group-focus-visible:ring-2 group-focus-visible:ring-white">
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
            // Панель — около трети окна, но не уже 20rem (комментарии читаемы) и не шире
            // 26rem (кадр остаётся главным). Без медиа — вся ширина компактного окна.
            cur
              ? 'md:w-[clamp(20rem,32%,26rem)] md:shrink-0 md:border-l md:border-border'
              : 'md:flex-auto',
          )}
        >
          {/* Шапка — тот же блок автора, что в карточке ленты (PostByline), справа меню
              поста и крестик. Крестик в шапке, а не в углу затемнения: на телефоне окно во
              весь экран, и угловая кнопка ложилась поверх меню «•••». */}
          <header
            className={cn(
              'flex shrink-0 items-center gap-3 py-3 pr-2 pl-4 md:border-b md:border-border',
              cur && 'max-md:order-1',
            )}
          >
            <PostByline post={post} />
            {/* Листание постов на телефоне — здесь: по краям экрана стрелки ложились на снимок
                рядом со стрелками карусели. На десктопе посты листают полосы по краям. */}
            {(onPrev || onNext) && (
              <div className="flex shrink-0 items-center sm:hidden">
                <HeaderIconButton label={t('prevPost')} onClick={onPrev} disabled={!onPrev}>
                  <ChevronLeft className="size-5" aria-hidden />
                </HeaderIconButton>
                <HeaderIconButton label={t('nextPost')} onClick={onNext} disabled={!onNext}>
                  <ChevronRight className="size-5" aria-hidden />
                </HeaderIconButton>
              </div>
            )}
            {/* Одно меню на пост: то же, что на карточке и плитке. */}
            <PostTileMenu
              post={menuPost}
              canModerate={canModerate}
              canDelete={canDelete}
              isMine={menuPost.authorId === myId}
              onDeleted={onClose}
              triggerClassName="size-9 rounded-full focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            />
            <CloseButton label={t('close')} onClick={onClose} />
          </header>

          {/* Подпись и комментарии — одна прокручиваемая лента, как в Instagram: подпись
              первой строкой с аватаром автора, дальше реплики. */}
          <div
            ref={threadRef}
            // flex-auto, а не flex-1: в компактном окне текста высота считается по содержимому,
            // и нулевая основа схлопнула бы ленту; при упоре в 85vh она сжимается и прокручивается.
            className={cn(
              'sh-scroll flex flex-col gap-4 px-4 py-3 max-md:shrink-0 md:min-h-0 md:flex-auto md:overflow-y-auto',
              cur && 'max-md:order-4',
            )}
          >
            {via && <RepostBanner repost={via} />}
            {/* Подпись — без второго аватара и имени: автор и время уже в шапке, прямо над
                ней. Раньше подпись повторяла их в духе Instagram, и в окне без медиа автор
                стоял дважды подряд. */}
            {hasCaption && (
              <div className="flex flex-col gap-1.5">
                {post.title && (
                  <h2 className="text-base leading-snug font-semibold break-words">{post.title}</h2>
                )}
                {post.content && (
                  <div className="[overflow-wrap:anywhere]">
                    <Markdown source={post.content} autolink className="text-[0.9375rem]" />
                  </div>
                )}
                {/* Репост, чей исходник зрителю недоступен: без пометки в полном
                    просмотре не видно, что это репост. Доступный исходник открывается
                    сам, с пометкой «Репост от …» сверху. */}
                {originalUnavailable && <RepostUnavailable className="mt-1" />}
              </div>
            )}

            {/* Порядок ленты комментариев. Своего ранжирования у нас нет, поэтому честные
                «сначала новые / сначала старые», а не «сначала интересные». */}
            {/* Заголовок обсуждения отделён от подписи линией: иначе первая реплика читалась
                как продолжение текста поста. Переключатель порядка — только когда есть что
                упорядочивать. */}
            {commentCount > 0 && (
              <div
                className={cn(
                  'flex min-h-8 items-center justify-between gap-2 text-xs text-muted-foreground',
                  (hasCaption || via) && 'border-t border-border pt-3',
                )}
              >
                <span className="font-medium">{t('commentsCount', { count: commentCount })}</span>
                {commentCount > 1 && (
                  <button
                    type="button"
                    onClick={() => setNewestFirst((v) => !v)}
                    className="-mx-1.5 cursor-pointer rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    {newestFirst ? t('sortNewest') : t('sortOldest')}
                  </button>
                )}
              </div>
            )}

            {/* Пустой список ничего не подписывает: счётчик уже под лайками. Более ранние
                комментарии — там, где они встали бы по выбранному порядку. */}
            {comments.isLoading ? (
              <ul className="flex flex-col gap-4" aria-label={t('loadingComments')} aria-busy>
                {Array.from({ length: COMMENT_SKELETON_ROWS }, (_, i) => (
                  <li key={i} className="flex gap-3">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3.5 w-4/5" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : comments.isError ? (
              // Сбой загрузки — понятной фразой и повтором, без кода ошибки.
              <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                <p className="text-muted-foreground">{t('commentsError')}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void comments.refetch()}
                >
                  {tCommon('retry')}
                </Button>
              </div>
            ) : roots.length === 0 ? (
              // Пусто — компактно, под подписью: тихая иконка и одна фраза, без рамки.
              // Иконка — та же, что у кнопки «Комментировать» в ряду действий.
              <div
                className={cn(
                  'flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground',
                  (hasCaption || via) && 'border-t border-border',
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <MessageCircle className="size-5 -scale-x-100" aria-hidden />
                </span>
                <p className="max-w-60">{t('commentsEmpty')}</p>
              </div>
            ) : (
              <>
                {!newestFirst && earlierButton}
                {roots.length > 0 && (
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
                            canDelete={canDeleteComment(c)}
                            canReport={c.author.id !== myId && canReportComments}
                            fresh={c.id === freshId}
                            onReply={() => startReply(c.id, c.author)}
                            onDelete={() => removeComment(c)}
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
                              {open && (
                                // Ветка раскрывается коротким проявлением, а не скачком.
                                <div className="flex flex-col gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
                                  {replies.map((r) => (
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
                                      canDelete={canDeleteComment(r)}
                                      canReport={r.author.id !== myId && canReportComments}
                                      fresh={r.id === freshId}
                                      onReply={() => startReply(c.id, r.author)}
                                      onDelete={() => removeComment(r)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {newestFirst && earlierButton}
              </>
            )}
          </div>

          {/* Действия, как в Instagram: иконки без подписей и счётчиков, закладка справа;
              под ними число отметок и дата. На телефоне — сразу под медиа. */}
          <div
            className={cn(
              'shrink-0 px-2 pt-1.5 pb-3 md:border-t md:border-border',
              // Без медиа на телефоне — тот же порядок, что на десктопе: действия под
              // текстом. Перед текстом ряд лайков стоял бы между автором и его словами.
              cur ? 'max-md:order-3' : 'max-md:border-t max-md:border-border',
            )}
          >
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
                className="flex size-10 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none [&_svg]:size-6"
              />
              {/* Избранное — справа, отдельно от реакций: личная полка, а не вовлечение. */}
              <div className="ml-auto">
                <BarButton label={t('bookmark')} pressed={bookmarked} onClick={toggleBookmark}>
                  <Bookmark className={cn('size-6', bookmarked && 'fill-current')} aria-hidden />
                </BarButton>
              </div>
            </div>
            {/* Итог под действиями: отметки слева, просмотры справа. Дата — в шапке, рядом
                с автором; здесь она повторяла бы её второй раз. */}
            <div className="flex items-center justify-between gap-3 px-2">
              <p className="text-sm font-semibold">
                {t('likesCount', { count: reactionTotal(reactions) })}
              </p>
              <span
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
                title={t('viewsCount', { count: views })}
              >
                <Eye className="size-3.5" aria-hidden />
                {views}
              </span>
            </div>
          </div>

          {/* Поле ввода. На телефоне — прилипает к низу общего скролла, чтобы не искать
              его под длинной лентой комментариев. */}
          {/* Снизу на телефоне — поле под «домашнюю» полосу iOS (safe-area), иначе кнопка
              «Опубликовать» уходила под неё. */}
          <div
            className={cn(
              'shrink-0 border-t border-border bg-background max-md:sticky max-md:bottom-0 max-md:pb-[env(safe-area-inset-bottom)]',
              cur && 'max-md:order-5',
            )}
          >
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
            <div className="relative flex items-end gap-2 px-3 py-2.5">
              {/* Пикер эмодзи */}
              <div ref={emojiRef} className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('emoji')}
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((o) => !o)}
                  className={cn(
                    'flex size-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
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

              {/* Поле — на мягкой подложке с кольцом фокуса: голая строка без границ в тёмной
                  теме не читалась как место, куда можно писать. */}
              <div className="flex min-w-0 flex-1 rounded-2xl bg-muted/60 px-3 ring-1 ring-transparent transition-shadow duration-150 focus-within:ring-ring/40">
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
                      send()
                    }
                  }}
                  placeholder={replyTo ? t('replyPlaceholder') : t('commentPlaceholder')}
                  aria-label={replyTo ? t('replyPlaceholder') : t('commentPlaceholder')}
                  className="max-h-28 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-snug outline-none placeholder:text-muted-foreground"
                />
              </div>

              <button
                type="button"
                onClick={send}
                disabled={text.trim().length === 0 || addMut.isPending}
                aria-busy={addMut.isPending}
                className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 self-end rounded-lg px-2 text-sm font-semibold text-primary transition-colors duration-150 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-default disabled:bg-transparent disabled:opacity-40"
              >
                {addMut.isPending && (
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                )}
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
      className="flex size-10 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:bg-muted/70 disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// Текстовые действия реплики («Ответить», «Удалить»): поле вокруг слова — чтобы попадать
// пальцем, отрицательные поля — чтобы текст стоял на той же вертикали, что и реплика.
const COMMENT_ACTION =
  '-mx-1 cursor-pointer rounded px-1 py-1 transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none'
// Второстепенные действия проявляются при наведении (на телефоне наводить нечем — видны).
const COMMENT_ACTION_QUIET =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100'

/** Крестик окна: в шапке поста и в заготовке, пока грузится исходник репоста. */
function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HeaderIconButton label={label} onClick={onClick}>
      <X className="size-5" aria-hidden />
    </HeaderIconButton>
  )
}

/** Иконочная кнопка шапки окна: 36px, тихая, с подсветкой при наведении и фокусе. */
function HeaderIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  )
}

/**
 * Ширина окна просмотра под самое широкое вложение поста: панель (26rem) плюс кадр во всю
 * высоту окна (92dvh) в пропорциях снимка. Без размеров хотя бы у одного вложения — `null`:
 * окно во всю доступную ширину, как раньше.
 */
function lightboxWidthFor(media: readonly PostMedia[]): string | null {
  let ratio = 0
  for (const m of media) {
    if (!m.width || !m.height) return null
    ratio = Math.max(ratio, m.width / m.height)
  }
  return ratio > 0 ? `calc(26rem + 92dvh * ${ratio.toFixed(3)})` : null
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
  fresh = false,
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
  /** Только что отправлен — проявляется плавно. */
  fresh?: boolean
}) {
  const t = useTranslations('Feed')
  const [reporting, setReporting] = useState(false)
  // Длинная реплика свёрнута до шести строк: иначе одна простыня уводила остальные
  // комментарии за край панели.
  const long = content.length > LONG_COMMENT_CHARS || content.split('\n').length > 8
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      data-comment-id={id}
      // На телефоне поле ввода прилипает к низу скролла — отступ, чтобы прокрутка к
      // новой реплике не прятала её под ним.
      className={cn(
        'group flex gap-3 max-md:scroll-mb-20',
        fresh &&
          'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none',
      )}
    >
      {/* Аватар одного размера у реплик и ответов: иерархию ветки задаёт сдвиг вправо, а
          разные кегли лиц в одной колонке выглядели неряшливо. */}
      <ProfileLink userId={author.id} className="shrink-0 rounded-full">
        <Avatar className="size-8">
          {author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
          <AvatarFallback className="text-[10px]">{initials(author)}</AvatarFallback>
        </Avatar>
      </ProfileLink>
      <div className="min-w-0 flex-1">
        {/* Сетка реплики: имя и время — одной строкой сверху, текст — под ними, действия —
            последней строкой. Прежняя раскладка «имя и текст одной строкой» терялась на
            длинных фамилиях: текст начинался с середины второй строки. */}
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm leading-snug">
          <ProfileLink
            userId={author.id}
            className="truncate font-semibold transition-colors duration-150 hover:text-primary"
          >
            {author.lastName} {author.firstName}
          </ProfileLink>
          {/* Метка автора: в чужой ветке важно видеть, где ответил сам публикатор, а
              где такой же читатель. Статусной парой (§2.2), а не своим цветом. */}
          {isPostAuthor && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary">
              {t('commentAuthorTag')}
            </span>
          )}
          <time dateTime={createdAt} className="shrink-0 text-xs text-muted-foreground">
            {relativeTime(createdAt, locale)}
          </time>
        </p>
        <p
          className={cn(
            'mt-0.5 text-sm leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere]',
            long && !expanded && 'line-clamp-6',
          )}
        >
          {replyTo && (
            <span className="text-primary">
              @{replyTo.firstName} {replyTo.lastName}{' '}
            </span>
          )}
          <CommentText text={content} />
        </p>
        {long && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className={cn(COMMENT_ACTION, 'mt-0.5 font-semibold')}
          >
            {expanded ? t('showLess') : t('showMore')}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {onReply && (
            <button type="button" onClick={onReply} className={cn(COMMENT_ACTION, 'font-semibold')}>
              {t('reply')}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className={cn(COMMENT_ACTION, COMMENT_ACTION_QUIET)}
            >
              {t('report')}
            </button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className={cn(COMMENT_ACTION, COMMENT_ACTION_QUIET, 'hover:text-destructive')}
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
