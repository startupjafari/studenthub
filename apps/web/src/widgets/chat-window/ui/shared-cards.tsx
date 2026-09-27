'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronRight, Heart, Images, MessageCircle, Play, UserRound } from 'lucide-react'
import type { SharedPostPreview } from '../../../entities/chat'
import { fetchPostMediaUrl, postKeys } from '../../../entities/post'
import { fetchUserById, userKeys } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, Markdown } from '../../../shared/ui'
import { identityColor, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

// Карточки того, чем поделились в чате: пост и профиль. Живут в виджете, а не в
// `entities/chat`: им нужны данные поста и человека, а сущность из соседней сущности
// брать нельзя (FRONTEND_RULES §2.1).

/**
 * Пост, пересланный в чат, — карточкой, как ссылка в Telegram: сверху обложка (первое фото
 * или кадр видео), под ней автор, заголовок и начало текста, внизу счётчики.
 *
 * Нажатие ведёт в профиль автора и сразу открывает там сам пост (`?post=`): человеку
 * прислали публикацию, а не автора, и искать её в сетке профиля заставлять нельзя.
 */
export function ChatSharedPost({ post, mine }: { post: SharedPostPreview; mine: boolean }) {
  const t = useTranslations('Feed')

  if (post.deletedAt) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {t('postUnavailable')}
      </div>
    )
  }

  const name = `${post.author.lastName} ${post.author.firstName}`.trim()
  const cover = post.media[0]

  return (
    <Link
      href={`/profile/${post.authorId}?post=${post.id}`}
      className={cn(
        'group block w-full max-w-[22rem] overflow-hidden rounded-2xl border bg-card text-foreground transition-colors',
        mine ? 'border-white/15' : 'border-border',
        'hover:border-ring/50',
      )}
    >
      {cover && <PostCover postId={post.id} media={cover} />}
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          <Avatar className="size-6 shrink-0">
            {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt="" />}
            <AvatarFallback
              className={cn('text-[10px] font-medium text-white', identityColor(post.author.id))}
            >
              {identityInitials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{t('sharedPostLabel')}</span>
        </div>
        {post.title && <p className="line-clamp-2 text-sm font-semibold">{post.title}</p>}
        {post.content && (
          // Разметку разбираем и здесь: иначе в чат уезжали звёздочки `**` вместо жирного.
          <Markdown source={post.content} className="line-clamp-3 text-sm text-foreground/90" />
        )}
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3.5" aria-hidden />
            {post._count.reactions}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden />
            {post._count.comments}
          </span>
          <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-primary">
            {t('sharedPostOpen')}
            <ChevronRight className="size-3.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}

/**
 * Обложка карточки: подписанная ссылка на медиа поста — тем же запросом и в тот же кэш,
 * что у плиток ленты. Видео — первым кадром со значком «▶», а не проигрывателем: в
 * переписке это превью, смотрят его уже в самом посте.
 */
function PostCover({ postId, media }: { postId: string; media: { id: string; mime: string } }) {
  const isVideo = media.mime.startsWith('video/')
  const url = useQuery({
    queryKey: postKeys.media(media.id),
    queryFn: () => fetchPostMediaUrl(postId, media.id),
    staleTime: 10 * 60 * 1000,
  })

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-muted">
      {url.data ? (
        isVideo ? (
          <video
            src={url.data}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          // Подписанный адрес хранилища — обычный img, не next/image: оптимизатор его не знает.
          <img
            src={url.data}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Images className={cn('size-6', url.isLoading && 'animate-pulse')} aria-hidden />
        </div>
      )}
      {isVideo && url.data && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="size-5 translate-x-0.5 fill-current" aria-hidden />
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * Профиль, пересланный в чат. Отдельного типа сообщения у профиля нет: «Поделиться →
 * в чат» шлёт текст «Имя + ссылка на профиль». Узнаём его здесь по этой форме — и только
 * со ссылкой на наш же сайт: чужой адрес с `/profile/` карточкой не станет, иначе ей
 * можно было бы выдать любую страницу за профиль человека с платформы.
 */
export function parseProfileShare(content: string | null): { userId: string; name: string } | null {
  if (!content || typeof window === 'undefined') return null
  const lines = content.trim().split('\n')
  if (lines.length !== 2) return null
  const [name, link] = lines as [string, string]
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  const match = /^\/profile\/([\w-]+)\/?$/.exec(url.pathname)
  return match?.[1] ? { userId: match[1], name: name.trim() } : null
}

/**
 * Карточка пересланного профиля: аватар, имя, чем человек занимается. Данные — тем же
 * запросом, что у страницы профиля: карточка и переход по ней делят кэш, и профиль
 * открывается уже с шапкой. Не удалось загрузить (профиль скрыт или удалён) — остаётся
 * имя из сообщения: оно тоже ведёт в профиль, а там сервер скажет, что можно видеть.
 */
export function ChatSharedProfile({
  userId,
  name,
  mine,
}: {
  userId: string
  name: string
  mine: boolean
}) {
  const t = useTranslations('Chats')
  const tRoles = useTranslations('Roles')
  const user = useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => fetchUserById(userId),
    retry: false,
    staleTime: 60_000,
  })

  const u = user.data
  const fullName = u ? `${u.lastName} ${u.firstName}`.trim() : name
  const subtitle = u ? u.headline || u.position || u.jobTitle || tRoles(u.role) : null
  const avatar = u?.avatarThumbUrl ?? u?.avatarUrl ?? null

  return (
    <Link
      href={`/profile/${userId}`}
      className={cn(
        'flex w-full max-w-[22rem] items-center gap-3 rounded-2xl border bg-card p-3 text-foreground transition-colors hover:border-ring/50',
        mine ? 'border-white/15' : 'border-border',
      )}
    >
      <Avatar className="size-12 shrink-0">
        {avatar && <AvatarImage src={avatar} alt="" />}
        <AvatarFallback className={cn('text-sm font-medium text-white', identityColor(userId))}>
          {fullName ? identityInitials(fullName) : <UserRound className="size-5" aria-hidden />}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t('sharedProfileLabel')}
        </span>
        <span className="truncate text-sm font-semibold">{fullName}</span>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary">
        {t('sharedProfileOpen')}
        <ChevronRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  )
}
