'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Bookmark, Building2, Eye, Heart, MessageSquare, Pin, Play, Repeat2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  LIKE_EMOJI,
  addReactionRequest,
  canRepost,
  hasMyReaction,
  patchCachedPost,
  reactionSummaryOf,
  reactionTotal,
  removeReactionRequest,
  withMyReaction,
  type FeedPost,
  type PostMedia,
  type PostReactionSummary,
} from '../../../entities/post'
import { ProfileLink } from '../../../entities/user'
import { CompanyMark, companyPath } from '../../../entities/company'
import { RepostDialog, useRepost } from '../../../features/repost-post'
import { Avatar, AvatarFallback, AvatarImage, Markdown, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { relativeTime, toApiError } from '../../../shared/lib'
import { PostMediaView } from './post-media'
import { SharePostMenu } from '../../../features/share-post'
import { useBookmark } from '../../../features/bookmark-post'
import { MediaFrame } from './media-frame'
import { PostTileMenu } from './post-tile-menu'
import { RepostBanner, RepostUnavailable } from './repost-banner'
import { useRepostSource } from '../lib/use-repost-source'

const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]
/** Сколько превью показываем в коллаже; остальное сворачивается в «+N». */
const MEDIA_TILES = 4

function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

/**
 * Пост в ленте — развёрнутая карточка в одну колонку (как во «ВКонтакте»).
 *
 * Комментарии здесь не разворачиваются: читать и писать их — в полном просмотре.
 * Развёрнутая ветка прямо в ленте растягивала карточку на экран и отодвигала
 * следующие посты, а обсуждение всё равно требует места под медиа и вложенные ответы.
 *
 * Раньше лента была сеткой квадратных плиток: чтобы прочитать текст поста, его
 * приходилось открывать, а объявление деканата на три строки превращалось в
 * картинку-заглушку с градиентом. Здесь пост читается целиком не выходя из ленты:
 * автор, текст, медиа, действия и комментарии на месте.
 *
 * Сетка плиток осталась там, где она уместна, — в профиле, как галерея.
 */
interface PostCardProps {
  post: FeedPost
  /** Открыть полный просмотр на вложении с этим номером (клик по плитке коллажа). */
  onOpenMedia?: (mediaIndex: number) => void
  /** Комментарии живут только в полном просмотре — здесь лишь вход в него. */
  onOpenComments?: () => void
}

/**
 * Репост — как в Instagram: в ленте стоит сам исходный пост (медиа, лайки, комментарии
 * его автора), а над ним пометка «↻ Репост от …» с заметкой. Пока исходник грузится —
 * скелетон карточки; недоступен зрителю — карточка репоста с пометкой «Публикация
 * недоступна» вместо цитаты.
 */
export function PostCard(props: PostCardProps) {
  const source = useRepostSource(props.post)
  if (source.kind === 'loading') {
    return (
      <article
        className="flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5"
        aria-hidden
      >
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
        <Skeleton className="h-48 w-full" />
      </article>
    )
  }
  if (source.kind === 'ready') {
    return <PostCardView {...props} key={source.source.id} post={source.source} via={props.post} />
  }
  return <PostCardView {...props} originalUnavailable={source.kind === 'unavailable'} />
}

function PostCardView({
  post,
  via,
  originalUnavailable = false,
  onOpenMedia,
  onOpenComments,
}: PostCardProps & {
  /** Репост, через который показан `post` (исходник): его меню и его пометка сверху. */
  via?: FeedPost
  /** `post` — репост, чей исходник зрителю недоступен (удалён или чужой аудитории). */
  originalUnavailable?: boolean
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const [reactions, setReactions] = useState(() => reactionSummaryOf(post, myId))
  // Репост уходит в собственную ленту сразу по нажатию; окно остаётся только тем ролям,
  // у кого «своей» аудитории нет и цель приходится выбирать руками (useRepost).
  const { audience: repostAudience, repost, isPending: repostPending } = useRepost()
  const [repostDialog, setRepostDialog] = useState(false)

  const byRole = myRole !== null && MODERATOR_ROLES.includes(myRole)
  // Меню — про публикацию в ленте: у репоста это сам репост, а не чужой исходник.
  const menuPost = via ?? post
  // Права считает сервер (ранг относительно автора и scope): по одной роли модератор вуза
  // видел «Удалить» на посте админа, декан — на чужом факультете, и нажатие давало 403.
  // Роль — только для ответа старого API без признаков.
  const canModerate = menuPost.canPin ?? byRole
  const canDelete = menuPost.canDelete ?? (menuPost.authorId === myId || byRole)
  // Репост репоста ссылается на исходник — а он зрителю недоступен, сервер откажет.
  const showRepost = !originalUnavailable && canRepost(myRole, post)
  const liked = hasMyReaction(reactions, LIKE_EMOJI)
  const { bookmarked, toggle: toggleBookmark } = useBookmark(post.id, post.bookmarked)

  // Сводка реакций — из кэша постов: лайк из полного просмотра того же поста приходит сюда
  // правкой кэша (patchCachedPost), и карточка не расходится с ним.
  useEffect(() => setReactions(reactionSummaryOf(post, myId)), [post, myId])

  // Оптимистичный лайк с откатом (docs/FRONTEND_RULES.md §5.5) — и в кэше постов, чтобы
  // полный просмотр того же поста видел тот же лайк.
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

  // Дата поста — момент публикации (§3.3): отложенный пост и черновик создают раньше, чем
  // они выходят. Своему черновику и отложенному даты публикации ещё нет — у них дата создания.
  const shownAt = post.publishedAt ?? post.createdAt
  const created = new Date(shownAt)
  // «4 д назад» вместо «27.08, 11:15»: в ленте важен возраст поста, а не точная дата.
  // Точная — в подсказке, для тех случаев, когда она всё-таки нужна.
  const ago = relativeTime(shownAt, locale)
  const exactTime = created.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <article
      className={cn(
        // Без `overflow-hidden`: он обрезал поповер «•••» у невысокой карточки — меню
        // раскрывается вниз из шапки и у короткого текстового поста не помещается.
        // Медиа лежит в середине карточки и скруглённых углов не касается.
        'flex flex-col rounded-2xl bg-card ring-1 ring-foreground/10',
        post.pinnedAt && 'ring-primary/40',
      )}
    >
      {via && <RepostBanner repost={via} className="px-4 pt-3 sm:px-5" />}
      {/* Шапка: имя забирает всю свободную ширину и сокращается многоточием, роль, кому
          адресован пост и его возраст — второй строкой и приглушённо. */}
      <header className={cn('flex items-center gap-3 px-4 sm:px-5', via ? 'pt-3' : 'pt-4')}>
        {/* Пост страницы компании говорит от её имени: логотип и название компании, а
            сотрудник-автор — второй строкой. Профиль работодателя закрыт, ссылка ведёт на
            страницу компании. */}
        {post.company ? (
          <Link
            href={companyPath(post.company.id)}
            className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Avatar className="size-10">
              {post.company.logoUrl && <AvatarImage src={post.company.logoUrl} alt="" />}
              <AvatarFallback>
                <Building2 className="size-5" aria-hidden />
              </AvatarFallback>
            </Avatar>
          </Link>
        ) : (
          <ProfileLink userId={post.author.id} className="shrink-0 rounded-full">
            <Avatar className="size-10">
              {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt="" />}
              <AvatarFallback>{initials(post.author)}</AvatarFallback>
            </Avatar>
          </ProfileLink>
        )}
        <div className="min-w-0 flex-1">
          {post.company ? (
            <p className="flex min-w-0 items-center gap-1.5 text-sm leading-tight font-semibold">
              <Link
                href={companyPath(post.company.id)}
                className="truncate transition-colors duration-150 hover:text-primary"
              >
                {post.company.name}
              </Link>
              <CompanyMark />
            </p>
          ) : (
            <p className="truncate text-sm leading-tight font-semibold">
              <ProfileLink
                userId={post.author.id}
                className="transition-colors duration-150 hover:text-primary"
              >
                {post.author.lastName} {post.author.firstName}
              </ProfileLink>
            </p>
          )}
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {post.pinnedAt && (
              <Pin className="size-3 shrink-0 fill-current text-primary" aria-hidden />
            )}
            <span className="truncate">
              {post.company
                ? `${post.author.lastName} ${post.author.firstName}`
                : tRoles(post.author.role)}{' '}
              · {t(`audience${post.audience}`)}
            </span>
            <span aria-hidden className="shrink-0">
              ·
            </span>
            {/* Возраст поста не переносим: «45 мин. назад» в узкой колонке ломалось. */}
            <time dateTime={shownAt} title={exactTime} className="shrink-0 whitespace-nowrap">
              {ago}
            </time>
          </p>
        </div>
        {post.status === 'DRAFT' && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
            {t('statusDraft')}
          </span>
        )}
        {post.status === 'SCHEDULED' && (
          <span className="rounded-full bg-info/15 px-2 py-0.5 text-[11px] font-medium text-info">
            {t('statusScheduled')}
          </span>
        )}
        <PostTileMenu
          post={menuPost}
          canModerate={canModerate}
          canDelete={canDelete}
          isMine={menuPost.authorId === myId}
          triggerClassName="size-9 rounded-full focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        />
      </header>

      {/* Порядок как во «ВКонтакте»: сначала вложение, под ним текст. Картинка —
          то, за что цепляется глаз при пролистывании, а текст читают уже решив
          остановиться. */}
      {post.media.length > 0 && (
        <MediaCollage
          postId={post.id}
          media={post.media}
          onOpen={(i) => onOpenMedia?.(i)}
          openLabel={t('openPost')}
        />
      )}

      {(post.title || post.content) && <PostBody title={post.title} text={post.content} />}

      {originalUnavailable && <RepostUnavailable className="mx-4 mt-3 sm:mx-5" />}

      {/* Панель действий — как во «ВКонтакте»: лайк, комментарии, репост и «поделиться»
          слева, просмотры справа. Подписи видны с `sm`: голые иконки читаются
          только теми, кто уже знает, что они делают. */}
      <div className="mt-3 flex items-center gap-0.5 px-2 pb-2 text-sm text-muted-foreground sm:px-3">
        <ActionButton
          label={t('like')}
          pressed={liked}
          onClick={toggleLike}
          count={reactionTotal(reactions)}
        >
          {/* Короткий отклик на лайк: сердце чуть «вспухает» при постановке, без прыжков. */}
          <Heart
            key={liked ? 'on' : 'off'}
            className={cn(
              'size-5',
              liked &&
                'fill-destructive text-destructive animate-in zoom-in-75 duration-200 motion-reduce:animate-none',
            )}
            aria-hidden
          />
        </ActionButton>
        <ActionButton label={t('comment')} onClick={onOpenComments} count={post._count.comments}>
          <MessageSquare className="size-5" aria-hidden />
        </ActionButton>
        {showRepost && (
          <ActionButton
            label={t('repost')}
            disabled={repostPending}
            onClick={() => (repostAudience ? repost(post.id) : setRepostDialog(true))}
          >
            <Repeat2 className="size-5" aria-hidden />
          </ActionButton>
        )}
        {/* «Поделиться» — меню: ссылка, чат, системное меню. Прямое открытие
            пересылки в чат оставляло единственный способ поделиться, и то внутри
            платформы. */}
        <SharePostMenu
          postId={post.id}
          className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        />
        {/* Избранное — последним в ряду и без счётчика: это личная полка, а не
            вовлечение, и число «сколько людей сохранили» сервер не отдаёт намеренно. */}
        <ActionButton label={t('bookmark')} pressed={bookmarked} onClick={toggleBookmark}>
          <Bookmark
            className={cn('size-5', bookmarked && 'fill-primary text-primary')}
            aria-hidden
          />
        </ActionButton>
        {/* Справа — просмотры. Возраст поста переехал в шапку, ко второй строке автора:
            там его ищут глазами, а в ряду действий он спорил со счётчиками. */}
        <span
          className="ml-auto flex items-center gap-1.5 px-2 text-xs"
          title={t('viewsLabel', { count: post.views })}
        >
          <Eye className="size-4" aria-hidden />
          <span className="tabular-nums">{post.views}</span>
        </span>
      </div>

      {repostDialog && <RepostDialog post={post} onClose={() => setRepostDialog(false)} />}
    </article>
  )
}

// Свёрнутый текст — по высоте, около шести строк. Меньше — разворачивать нечего.
const COLLAPSED_TEXT_REM = 9.5

/**
 * Заголовок и текст поста в ленте.
 *
 * Свёрнут по высоте (около шести строк) с мягким затуханием, а не до первой строки:
 * прежняя «одна строка» обрывала объявление на полуслове, и пост приходилось открывать,
 * чтобы понять, о чём он. Разметка (списки, цитаты, ссылки) рисуется всегда — обрезка
 * высотой ничего в ней не ломает, в отличие от line-clamp. Кнопка появляется, только
 * если текст действительно не поместился.
 */
function PostBody({ title, text }: { title: string | null; text: string }) {
  const t = useTranslations('Feed')
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Меряем до отрисовки: кнопка «Читать далее» не должна появляться рывком.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = (): void => setOverflows(box.scrollHeight > box.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text])

  const clamped = !expanded && overflows

  return (
    <div className="flex flex-col gap-1.5 px-4 pt-3 sm:px-5">
      {title && <h2 className="text-base leading-snug font-semibold break-words">{title}</h2>}
      {text && (
        <div
          ref={boxRef}
          style={expanded ? undefined : { maxHeight: `${COLLAPSED_TEXT_REM}rem` }}
          className={cn(
            'relative overflow-hidden [overflow-wrap:anywhere]',
            clamped &&
              '[mask-image:linear-gradient(to_bottom,black_70%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_70%,transparent)]',
          )}
        >
          <Markdown source={text} autolink className="text-[0.9375rem]" />
        </div>
      )}
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="cursor-pointer self-start rounded text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  )
}

/**
 * Кнопка панели действий: иконка, необязательный счётчик, «нажатое» состояние.
 *
 * Без текстовой подписи: четыре слова подряд не помещались в колонку ленты и
 * выдавливали счётчик просмотров с датой на вторую строку. Название действия
 * остаётся в `aria-label` и в подсказке при наведении.
 */
function ActionButton({
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
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={cn(
        'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground active:bg-muted/70',
        'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        pressed && 'text-foreground',
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  )
}

/**
 * Коллаж вложений в порядке загрузки. Одно — во всю ширину в своих пропорциях (высота
 * ограничена, поля закрывает размытая копия); два — в ряд квадратами; три — крупное слева
 * и два справа; четыре и больше — сетка 2×2 с «+N» на последней плитке. У сеток высота
 * задана пропорцией контейнера: коллаж не вырастает выше разумного на широкой колонке.
 * Клик открывает полный просмотр именно на этой плитке.
 */
function MediaCollage({
  postId,
  media,
  onOpen,
  openLabel,
}: {
  postId: string
  media: PostMedia[]
  onOpen?: (index: number) => void
  openLabel: string
}) {
  const tiles = media.slice(0, MEDIA_TILES)
  const rest = media.length - tiles.length
  const count = media.length
  const layout =
    count === 1
      ? 'grid-cols-1'
      : count === 2
        ? 'grid-cols-2'
        : count === 3
          ? 'aspect-[3/2] grid-cols-[2fr_1fr] grid-rows-2'
          : 'aspect-[4/3] grid-cols-2 grid-rows-2'

  return (
    <div className={cn('mt-3 grid gap-0.5', layout)}>
      {tiles.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onOpen?.(i)}
          aria-label={`${openLabel} · ${i + 1}/${count}`}
          className={cn(
            'group/tile relative block min-h-0 overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
            // Одиночное медиа не режем под квадрат: у объявления это обычно афиша
            // или скан, и обрезка съедала бы половину смысла.
            count !== 1 && 'bg-muted',
            count === 2 && 'aspect-square',
            count === 3 && i === 0 && 'row-span-2',
          )}
        >
          {count === 1 ? (
            <MediaFrame postId={postId} media={m} imageClassName="max-h-[min(36rem,70vh)]" />
          ) : (
            <PostMediaView
              postId={postId}
              media={m}
              fit="cover"
              sizes={
                count === 3 && i === 0
                  ? '(max-width: 768px) 66vw, 490px'
                  : '(max-width: 768px) 50vw, 368px'
              }
              className="size-full transition-transform duration-200 group-hover/tile:scale-[1.02] motion-reduce:transition-none"
            />
          )}
          {m.mime.startsWith('video/') && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                <Play className="ml-0.5 size-6 fill-current" aria-hidden />
              </span>
            </span>
          )}
          {rest > 0 && i === tiles.length - 1 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-semibold text-white">
              +{rest}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
