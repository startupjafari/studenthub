'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Bookmark, Eye, Heart, MessageCircle } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  LIKE_EMOJI,
  addReactionRequest,
  hasMyReaction,
  patchCachedPost,
  reactionSummaryOf,
  reactionTotal,
  removeReactionRequest,
  withMyReaction,
  type FeedPost,
  type PostReactionSummary,
} from '../../../entities/post'
import { Markdown, Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import { PostByline } from './post-byline'
import { SharePostMenu } from '../../../features/share-post'
import { useBookmark } from '../../../features/bookmark-post'
import { PostGallery } from './post-gallery'
import { PostTileMenu } from './post-tile-menu'

// Полноэкранный просмотр (щипок, колесо, свайпы, видео) — отдельным чанком: ленте он нужен
// только после нажатия на кадр.
const PostMediaViewer = dynamic(
  () => import('./post-media-viewer').then((m) => m.PostMediaViewer),
  { ssr: false },
)

const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

/**
 * Пост в ленте — одна карточка для всех видов публикаций: автор и кому адресовано, текст,
 * медиа, панель действий. Текст стоит перед медиа, как в Threads и LinkedIn: подпись
 * объясняет снимок, а не теряется под ним.
 *
 * Комментарии здесь не разворачиваются: читать и писать их — в полном просмотре поста
 * (`onOpenComments`). Нажатие на кадр открывает полноэкранный просмотр сразу, без
 * промежуточного окна.
 *
 * Сетка плиток осталась там, где она уместна, — в профиле, как галерея.
 */
interface PostCardProps {
  post: FeedPost
  /** Комментарии живут только в полном просмотре — здесь лишь вход в него. */
  onOpenComments?: () => void
  /** Класс карточки — например, `sh-live-in` у поста, только что пришедшего в ленту. */
  className?: string
}

export function PostCard({ post, onOpenComments, className }: PostCardProps) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const [reactions, setReactions] = useState(() => reactionSummaryOf(post, myId))
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  // Плитки кадров — точки, откуда растёт полноэкранный просмотр и куда он садится.
  const tiles = useRef(new Map<number, HTMLElement>())
  const tileRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) tiles.current.set(index, el)
    else tiles.current.delete(index)
  }, [])
  // Лайк в полёте: повторное нажатие до ответа сервера не шлёт второй запрос вдогонку.
  const likeBusy = useRef(false)

  const byRole = myRole !== null && MODERATOR_ROLES.includes(myRole)
  // Права считает сервер (ранг относительно автора и scope): по одной роли модератор вуза
  // видел «Удалить» на посте админа, декан — на чужом факультете, и нажатие давало 403.
  // Роль — только для ответа старого API без признаков.
  const canModerate = post.canPin ?? byRole
  const canDelete = post.canDelete ?? (post.authorId === myId || byRole)
  const liked = hasMyReaction(reactions, LIKE_EMOJI)
  const { bookmarked, toggle: toggleBookmark } = useBookmark(post.id, post.bookmarked)

  // Сводка реакций — из кэша постов: лайк из полного просмотра того же поста приходит сюда
  // правкой кэша (patchCachedPost), и карточка не расходится с ним.
  useEffect(() => setReactions(reactionSummaryOf(post, myId)), [post, myId])

  // Оптимистичный лайк с откатом (docs/FRONTEND_RULES.md §5.5) — и в кэше постов, чтобы
  // полный просмотр того же поста видел тот же лайк.
  function toggleLike(): void {
    if (!myId || likeBusy.current) return
    likeBusy.current = true
    const prev = reactions
    const apply = (summary: PostReactionSummary[]): void => {
      setReactions(summary)
      patchCachedPost(qc, post.id, (p) => ({ ...p, reactionSummary: summary }))
    }
    apply(withMyReaction(prev, LIKE_EMOJI, !liked))
    const request = liked ? removeReactionRequest : addReactionRequest
    request(post.id, LIKE_EMOJI)
      .catch((e: unknown) => {
        apply(prev)
        toast.error(tErr(toApiError(e).code))
      })
      .finally(() => {
        likeBusy.current = false
      })
  }

  return (
    <article
      className={cn(
        // Без `overflow-hidden`: он обрезал поповер «•••» у невысокой карточки — меню
        // раскрывается вниз из шапки и у короткого текстового поста не помещается.
        // Радиус и обводка — как у системной `Card` (rounded-xl, ring-foreground/10).
        // На телефоне — во всю ширину экрана, без скруглений и боковых полей: каждый
        // пиксель ширины уходит снимку и тексту, а посты разделяют линии сверху и снизу.
        // Закреплённый отличается только мягкой акцентной обводкой — без заливки и тени.
        'flex flex-col bg-card max-sm:border-y max-sm:border-border sm:rounded-xl sm:ring-1 sm:ring-foreground/10',
        post.pinnedAt && 'sm:ring-primary/25',
        className,
      )}
    >
      {/* Шапка: имя забирает всю свободную ширину и сокращается многоточием, роль, кому
          адресован пост и его возраст — второй строкой и приглушённо. */}
      <header className="flex items-center gap-3 py-3 pr-2 pl-4">
        <PostByline post={post} />
        {post.status === 'DRAFT' && (
          <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
            {t('statusDraft')}
          </span>
        )}
        {post.status === 'SCHEDULED' && (
          <span className="shrink-0 rounded-full bg-info/15 px-2 py-0.5 text-[11px] font-medium text-info">
            {t('statusScheduled')}
          </span>
        )}
        <PostTileMenu
          post={post}
          canModerate={canModerate}
          canDelete={canDelete}
          isMine={post.authorId === myId}
          bookmark={{ saved: bookmarked, toggle: toggleBookmark }}
          triggerClassName="size-11 rounded-full focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:size-10"
        />
      </header>

      {(post.title || post.content) && <PostBody title={post.title} text={post.content} />}

      {post.media.length > 0 && (
        <div className={cn((post.title || post.content) && 'mt-3')}>
          <PostGallery postId={post.id} media={post.media} onOpen={setViewerAt} tileRef={tileRef} />
        </div>
      )}

      {/* Панель действий: лайк, комментарии и «поделиться» слева, закладка и просмотры
          справа. Кнопки 44px под палец и 40px под курсор; иконки 20px. Поля ряда плюс
          внутренний отступ кнопки дают отступ текста: первая иконка — на одной вертикали
          с аватаром. */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 text-sm text-muted-foreground">
        <ActionButton
          label={t('like')}
          pressed={liked}
          onClick={toggleLike}
          count={reactionTotal(reactions)}
          className={cn(liked && 'text-destructive hover:text-destructive')}
        >
          {/* Короткий отклик на лайк: сердце чуть «вспухает» при постановке, без прыжков. */}
          <Heart
            key={liked ? 'on' : 'off'}
            className={cn(
              'size-5',
              liked && 'fill-current animate-in zoom-in-75 duration-200 motion-reduce:animate-none',
            )}
            aria-hidden
          />
        </ActionButton>
        <ActionButton label={t('comment')} onClick={onOpenComments} count={post._count.comments}>
          <MessageCircle className="size-5 -scale-x-100" aria-hidden />
        </ActionButton>
        {/* «Поделиться» — меню: ссылка, чат, системное меню. */}
        <SharePostMenu postId={post.id} className={cn(ACTION, '[&_svg]:size-5')} />
        <span className="ml-auto" />
        <ActionButton
          label={bookmarked ? t('unbookmark') : t('bookmark')}
          pressed={bookmarked}
          onClick={toggleBookmark}
          className={cn(bookmarked && 'text-primary hover:text-primary')}
        >
          <Bookmark className={cn('size-5', bookmarked && 'fill-current')} aria-hidden />
        </ActionButton>
        {/* Просмотры — справа и тише кнопок: это число, а не действие. */}
        <span
          className="flex min-h-11 items-center gap-1 pr-2.5 pl-1 text-xs tabular-nums sm:min-h-10"
          title={t('viewsLabel', { count: post.views })}
        >
          <Eye className="size-4" aria-hidden />
          <span className="sr-only">{t('viewsLabel', { count: post.views })}</span>
          <span aria-hidden>{post.views}</span>
        </span>
      </div>

      {viewerAt !== null && post.media[viewerAt] && (
        <PostMediaViewer
          post={post}
          index={viewerAt}
          onIndexChange={setViewerAt}
          onClose={() => setViewerAt(null)}
          getOrigin={(i) => tiles.current.get(i) ?? null}
        />
      )}
    </article>
  )
}

// Свёрнутый текст — пять строк по 1.5rem. Меньше — разворачивать нечего.
const COLLAPSED_TEXT_REM = 7.5

/**
 * Заголовок и текст поста в ленте.
 *
 * Свёрнут до пяти строк — без затемнения последних: обрыв по строке и «Читать далее»
 * читаются чище, чем растворяющийся текст. Разметка (списки, цитаты, ссылки) рисуется
 * всегда — обрезка высотой ничего в ней не ломает, в отличие от line-clamp. Кнопка
 * появляется, только если текст действительно не поместился; раскрытый текст сворачивается
 * обратно той же кнопкой. Высота меняется плавно (без движения, если оно отключено).
 */
function PostBody({ title, text }: { title: string | null; text: string }) {
  const t = useTranslations('Feed')
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const [fullHeight, setFullHeight] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Меряем до отрисовки: кнопка «Читать далее» не должна появляться рывком.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const collapsed =
      COLLAPSED_TEXT_REM * parseFloat(getComputedStyle(document.documentElement).fontSize)
    const measure = (): void => {
      setFullHeight(box.scrollHeight)
      setOverflows(box.scrollHeight > collapsed + 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text])

  return (
    <div className="flex flex-col gap-1 px-4">
      {title && <h2 className="text-base leading-snug font-semibold break-words">{title}</h2>}
      {text && (
        <div
          ref={boxRef}
          style={{
            maxHeight:
              expanded && fullHeight !== null ? `${fullHeight}px` : `${COLLAPSED_TEXT_REM}rem`,
          }}
          className="overflow-hidden transition-[max-height] duration-(--motion-large) ease-(--motion-ease) [overflow-wrap:anywhere] motion-reduce:transition-none"
        >
          <Markdown source={text} autolink className="text-[0.9375rem] leading-6" />
        </div>
      )}
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="-my-1 cursor-pointer self-start rounded py-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  )
}

// Кнопка панели действий: 44px под палец, 40px под курсор.
const ACTION =
  'flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 text-sm transition-colors duration-150 hover:bg-muted hover:text-foreground active:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 sm:min-h-10 sm:min-w-10'

/**
 * Кнопка панели действий: иконка, необязательный счётчик, «нажатое» состояние. Название —
 * в `aria-label` и подсказке при наведении. Цифры моноширинные: 9 → 10 меняет ширину на
 * одну цифру, а не пляшет на каждом значении.
 */
function ActionButton({
  label,
  count,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string
  count?: number
  pressed?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={count ? `${label} · ${count}` : label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(ACTION, pressed && 'text-foreground', className)}
        >
          {children}
          {count !== undefined && count > 0 && (
            <span aria-hidden className="tabular-nums">
              {count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
