'use client'

import { useTranslations } from 'next-intl'
import { Eye, Heart, Images, MessageCircle, Pin, Play } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { reactionSummaryOf, reactionTotal, type FeedPost } from '../../../entities/post'
import { cn } from '../../../shared/lib/utils'
import { plainPreview } from '../../../shared/lib'
import { BRAND_GRADIENT } from '../../../shared/config'
import { MosaicTile } from '../../../shared/ui'
import { PostMediaView } from './post-media'
import { PostTileMenu } from './post-tile-menu'

const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

interface PostTileProps {
  post: FeedPost
  onOpen: () => void
  /** Класс плитки — например, `sh-live-in` у поста, только что пришедшего по сокету. */
  className?: string
}

// Плитка публикации в сетке профиля (как в Instagram): обложка во всю плитку, подпись и
// счётчики — на затемнении снизу, чтобы читаться поверх любого снимка. Лайк, комментарий
// и закладка живут в лайтбоксе: на плитке они мельчили сетку и спорили с обложкой.
export function PostTile({ post, onOpen, className }: PostTileProps) {
  const t = useTranslations('Feed')
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const first = post.media[0]
  // Подпись плитки — без разметки: «**Совет дня.**» иначе показывался со звёздочками.
  const text = post.title || plainPreview(post.content, { chatMarkup: false })
  const byRole = myRole !== null && MODERATOR_ROLES.includes(myRole)
  // Права считает сервер (ранг и scope); роль — только для ответа старого API.
  const canModerate = post.canPin ?? byRole
  const canDelete = post.canDelete ?? (post.authorId === myId || byRole)

  return (
    // Плитка без обрезки: меню «•••» раскрывается за её край. Скругление обложки держит
    // внутренняя кнопка со своим `overflow-hidden`.
    <MosaicTile className={cn('overflow-visible', className)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={text || t('mediaPost')}
        className="absolute inset-0 overflow-hidden rounded-xl text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:ring-inset"
      >
        {first ? (
          <PostMediaView
            postId={post.id}
            media={first}
            fit="cover"
            sizes="(max-width: 640px) 33vw, 360px"
            className="size-full transition-transform duration-(--motion-large) group-hover/tile:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          // Текстовый пост — сам текст на фирменной подложке, как текстовые публикации в
          // Instagram: в квадрат помещается несколько строк, на телефоне — пара.
          <span
            className={cn('flex size-full items-center justify-center p-4 pb-12', BRAND_GRADIENT)}
          >
            <span
              className={cn(
                'text-center font-semibold text-white',
                'line-clamp-4 text-sm max-sm:line-clamp-3 max-sm:text-xs',
              )}
            >
              {text}
            </span>
          </span>
        )}

        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pt-8 pb-2.5 text-white">
          {first && text && (
            <span
              className={cn(
                'line-clamp-2 text-sm font-semibold leading-snug',
                // На телефоне плитка — треть ширины экрана: подпись там не читается.
                'max-sm:hidden',
              )}
            >
              {text}
            </span>
          )}
          <span className="flex items-center gap-3 text-xs font-medium text-white/90 tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3.5" aria-hidden />
              {reactionTotal(reactionSummaryOf(post))}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" aria-hidden />
              {post._count.comments}
            </span>
            <span className="inline-flex items-center gap-1 max-sm:hidden">
              <Eye className="size-3.5" aria-hidden />
              {post.views}
            </span>
          </span>
        </span>

        <span className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
          {post.status === 'DRAFT' && (
            <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
              {t('statusDraft')}
            </span>
          )}
          {post.status === 'SCHEDULED' && (
            <span className="rounded-full bg-info px-2 py-0.5 text-[11px] font-medium text-info-foreground">
              {t('statusScheduled')}
            </span>
          )}
          {post.pinnedAt && (
            <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
              <Pin className="size-3 fill-current" aria-hidden />
              {t('pinned')}
            </span>
          )}
        </span>
      </button>

      <span className="absolute right-2 top-2 z-10 flex items-center gap-1">
        {post.media.length > 1 ? (
          <Images className="size-5 text-white drop-shadow-md" aria-hidden />
        ) : first?.mime.startsWith('video/') ? (
          <Play className="size-5 fill-current text-white drop-shadow-md" aria-hidden />
        ) : null}
        {(canDelete || post.authorId !== myId) && (
          <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100 has-[[aria-expanded=true]]:opacity-100 max-lg:opacity-100">
            <PostTileMenu
              post={post}
              canModerate={canModerate}
              canDelete={canDelete}
              isMine={post.authorId === myId}
              triggerClassName="bg-black/45 text-white hover:bg-black/65 hover:text-white"
            />
          </span>
        )}
      </span>
    </MosaicTile>
  )
}
