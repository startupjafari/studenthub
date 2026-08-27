'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, Heart, MessageSquare, Pin, Play, Repeat2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  addReactionRequest,
  canRepost,
  removeReactionRequest,
  type FeedPost,
  type PostMedia,
  type PostReaction,
} from '../../../entities/post'
import { ProfileLink } from '../../../entities/user'
import { RepostDialog } from '../../../features/repost-post'
import { Avatar, AvatarFallback, Markdown } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { relativeTime } from '../../../shared/lib'
import { PostMediaView } from './post-media'
import { SharePostMenu } from '../../../features/share-post'
import { MediaFrame } from './media-frame'
import { PostTileMenu } from './post-tile-menu'

const LIKE = '❤️'
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
export function PostCard({
  post,
  onOpenMedia,
  onOpenComments,
}: {
  post: FeedPost
  onOpenMedia?: () => void
  /** Комментарии живут только в полном просмотре — здесь лишь вход в него. */
  onOpenComments?: () => void
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const [reactions, setReactions] = useState<PostReaction[]>(post.reactions)
  const [reposting, setReposting] = useState(false)

  const canModerate = myRole !== null && MODERATOR_ROLES.includes(myRole)
  const canDelete = post.authorId === myId || canModerate
  const showRepost = canRepost(myRole, post)
  const liked = reactions.some((r) => r.emoji === LIKE && r.userId === myId)

  // Оптимистичный лайк с откатом (docs/FRONTEND_RULES.md §5.5).
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

  const created = new Date(post.createdAt)
  // «4 д назад» вместо «27.08, 11:15»: в ленте важен возраст поста, а не точная дата.
  // Точная — в подсказке, для тех случаев, когда она всё-таки нужна.
  const ago = relativeTime(post.createdAt, locale)
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
        'flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10',
        post.pinnedAt && 'ring-primary/40',
      )}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <ProfileLink userId={post.author.id} className="shrink-0">
          <Avatar className="size-10">
            <AvatarFallback>{initials(post.author)}</AvatarFallback>
          </Avatar>
        </ProfileLink>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            <ProfileLink userId={post.author.id} className="hover:text-primary hover:underline">
              {post.author.lastName} {post.author.firstName}
            </ProfileLink>
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {post.pinnedAt && (
              <Pin className="size-3 shrink-0 fill-current text-primary" aria-hidden />
            )}
            {t(`audience${post.audience}`)}
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
          post={post}
          canModerate={canModerate}
          canDelete={canDelete}
          isMine={post.authorId === myId}
        />
      </header>

      {/* Порядок как во «ВКонтакте»: сначала вложение, под ним текст. Картинка —
          то, за что цепляется глаз при пролистывании, а текст читают уже решив
          остановиться. */}
      {post.media.length > 0 && (
        <MediaCollage
          postId={post.id}
          media={post.media}
          onOpen={onOpenMedia}
          openLabel={t('openPost')}
        />
      )}

      {(post.title || post.content) && <PostBody title={post.title} text={post.content} />}

      {post.original && (
        <div className="mx-4 mt-3 rounded-xl border-l-2 border-l-primary bg-muted/30 p-3 text-sm">
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

      {/* Панель действий — как во «ВКонтакте»: лайк, комментарии, репост и «поделиться»
          слева, просмотры справа. Подписи видны с `sm`: голые иконки читаются
          только теми, кто уже знает, что они делают. */}
      <div className="mt-3 flex items-center gap-0.5 px-2 pb-2 text-sm text-muted-foreground">
        <ActionButton
          label={t('like')}
          pressed={liked}
          onClick={toggleLike}
          count={reactions.length}
        >
          <Heart
            className={cn('size-5', liked && 'fill-destructive text-destructive')}
            aria-hidden
          />
        </ActionButton>
        <ActionButton label={t('comment')} onClick={onOpenComments} count={post._count.comments}>
          <MessageSquare className="size-5" aria-hidden />
        </ActionButton>
        {showRepost && (
          <ActionButton label={t('repost')} onClick={() => setReposting(true)}>
            <Repeat2 className="size-5" aria-hidden />
          </ActionButton>
        )}
        {/* «Поделиться» — меню: ссылка, чат, системное меню. Прямое открытие
            пересылки в чат оставляло единственный способ поделиться, и то внутри
            платформы. */}
        <SharePostMenu
          postId={post.id}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground"
        />
        {/* Справа — счётчик просмотров и возраст поста: во «ВКонтакте» дата стоит
            именно здесь, а не в шапке, где спорит с именем автора. */}
        <span className="ml-auto flex items-center gap-3 px-2 text-xs">
          <span
            className="flex items-center gap-1.5"
            title={t('viewsLabel', { count: post.views })}
          >
            <Eye className="size-4" aria-hidden />
            {post.views}
          </span>
          {/* Возраст поста не переносим: «45 мин. назад» в узкой колонке ломалось
              на три строки и раздвигало всю панель. */}
          <time dateTime={post.createdAt} title={exactTime} className="whitespace-nowrap">
            {ago}
          </time>
        </span>
      </div>

      {reposting && <RepostDialog post={post} onClose={() => setReposting(false)} />}
    </article>
  )
}

/**
 * Заголовок и текст поста в ленте.
 *
 * Свёрнутый текст — ОДНА строка и «Читать далее». Раньше показывались четыре, и
 * объявление на два экрана отодвигало следующий пост за нижний край: лента
 * переставала листаться глазами.
 *
 * В свёрнутом виде рисуем обычный текст первой строки, а не размеченный: line-clamp
 * поверх списков и цитат обрезает их непредсказуемо, и «одна строка» превращалась
 * то в полторы, то в пустоту.
 */
function PostBody({ title, text }: { title: string | null; text: string }) {
  const t = useTranslations('Feed')
  const [expanded, setExpanded] = useState(false)

  const firstLine = text.split('\n').find((l) => l.trim() !== '') ?? ''
  // Разворачивать нечего, если весь текст — эта самая строка без разметки.
  const collapsible = text.trim() !== firstLine.trim() || /[*`~[\]>]/.test(firstLine)

  return (
    <div className="flex flex-col gap-1.5 px-4 pt-3">
      {title && <h3 className="text-base leading-snug font-semibold">{title}</h3>}
      {text &&
        (expanded || !collapsible ? (
          <Markdown source={text} />
        ) : (
          <p className="line-clamp-1 text-sm leading-relaxed text-muted-foreground">{firstLine}</p>
        ))}
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="cursor-pointer self-start text-sm text-primary hover:underline"
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
  onClick,
  children,
}: {
  label: string
  count?: number
  pressed?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      title={label}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground',
        pressed && 'text-foreground',
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  )
}

/**
 * Коллаж вложений. Раскладка зависит от их числа: одно — во всю ширину, два — в ряд,
 * три — крупное слева и два справа, дальше — сетка 2×2 с «+N» на последней плитке.
 * Одна и та же сетка на любое количество либо резала одиночную картинку, либо
 * оставляла дыры.
 */
function MediaCollage({
  postId,
  media,
  onOpen,
  openLabel,
}: {
  postId: string
  media: PostMedia[]
  onOpen?: () => void
  openLabel: string
}) {
  const tiles = media.slice(0, MEDIA_TILES)
  const rest = media.length - tiles.length
  // Плитки квадратные, высоту держит число колонок. Три вложения — в один ряд по
  // трети ширины; от четырёх — сетка 2×2, а остальное уходит в «+N» на последней.
  const layout =
    media.length === 1 ? 'grid-cols-1' : media.length === 3 ? 'grid-cols-3' : 'grid-cols-2'

  return (
    <div className={cn('mt-3 grid gap-0.5', layout)}>
      {tiles.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className={cn(
            'relative block overflow-hidden',
            // Одиночное медиа не режем под квадрат: у объявления это обычно афиша
            // или скан, и обрезка съедала бы половину смысла. В сетке — квадрат.
            media.length !== 1 && 'aspect-square bg-muted',
          )}
        >
          {media.length === 1 ? (
            <MediaFrame postId={postId} media={m} imageClassName="max-h-[32rem]" />
          ) : (
            <PostMediaView postId={postId} media={m} fit="cover" className="size-full" />
          )}
          {m.mime.startsWith('video/') && (
            <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow-md">
              <Play className="size-10 fill-current" aria-hidden />
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
