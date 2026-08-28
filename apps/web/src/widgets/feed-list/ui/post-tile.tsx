'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Eye, Heart, Images, MessageCircle, Pin, Play, Repeat2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  addReactionRequest,
  canRepost,
  removeReactionRequest,
  type FeedPost,
  type PostReaction,
} from '../../../entities/post'
import { RepostDialog } from '../../../features/repost-post'
import { cn } from '../../../shared/lib/utils'
import { BRAND_GRADIENT } from '../../../shared/config'
import { PostMediaView } from './post-media'
import { SharePostMenu } from '../../../features/share-post'
import { PostTileMenu } from './post-tile-menu'

const LIKE = '❤️'
const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

// Карточка публикации в сетке (Instagram/VK-стиль): превью 4:3, контекст, и активные
// действия — лайк, комментарий (открывает подробную модалку с фокусом в поле), поделиться.
export function PostTile({
  post,
  onOpen,
  onOpenComment,
}: {
  post: FeedPost
  onOpen: () => void
  onOpenComment: () => void
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const myRole = useAppSelector((s) => s.auth.role)

  const [reactions, setReactions] = useState<PostReaction[]>(post.reactions)
  const [reposting, setReposting] = useState(false)

  const first = post.media[0]
  const comments = post._count.comments
  const canModerate = myRole !== null && MODERATOR_ROLES.includes(myRole)
  const canDelete = post.authorId === myId || canModerate
  const showRepost = canRepost(myRole, post)
  const date = new Date(post.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
  })
  const liked = reactions.some((r) => r.emoji === LIKE && r.userId === myId)

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

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:border-ring/50">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('openPost')}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-muted"
      >
        {first ? (
          <PostMediaView
            postId={post.id}
            media={first}
            fit="cover"
            className="size-full transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className={cn('flex size-full items-center justify-center p-4', BRAND_GRADIENT)}>
            <span className="line-clamp-4 text-center text-sm font-medium text-white">
              {post.title || post.content}
            </span>
          </div>
        )}

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
        {post.media.length > 1 ? (
          <span className="absolute right-2.5 top-2.5 text-white drop-shadow-md">
            <Images className="size-6" aria-hidden />
          </span>
        ) : first?.mime.startsWith('video/') ? (
          <span className="absolute right-2.5 top-2.5 text-white drop-shadow-md">
            <Play className="size-6 fill-current" aria-hidden />
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Слева — заголовок (текст поста), справа — дата и «•••» */}
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold leading-snug text-foreground hover:text-primary"
          >
            {post.title || post.content || t('mediaPost')}
          </button>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            <span className="whitespace-nowrap text-xs text-muted-foreground">{date}</span>
            {(canDelete || post.authorId !== myId) && (
              <PostTileMenu
                post={post}
                canModerate={canModerate}
                canDelete={canDelete}
                isMine={post.authorId === myId}
              />
            )}
          </div>
        </div>

        {/* Действия: лайк · комментарий (открывает модалку + фокус) · поделиться */}
        <div className="mt-auto flex items-center gap-4 border-t border-border pt-3 text-sm text-muted-foreground">
          <button
            type="button"
            aria-label={t('like')}
            aria-pressed={liked}
            onClick={toggleLike}
            className="flex items-center gap-1.5 transition-transform hover:scale-105 hover:text-foreground"
          >
            <Heart
              className={cn('size-5', liked && 'fill-destructive text-destructive')}
              aria-hidden
            />
            {reactions.length}
          </button>
          <button
            type="button"
            aria-label={t('comment')}
            onClick={onOpenComment}
            className="flex items-center gap-1.5 transition-transform hover:scale-105 hover:text-foreground"
          >
            <MessageCircle className="size-5" aria-hidden />
            {comments}
          </button>
          {showRepost && (
            <button
              type="button"
              aria-label={t('repost')}
              onClick={() => setReposting(true)}
              className="transition-transform hover:scale-105 hover:text-foreground"
            >
              <Repeat2 className="size-5" aria-hidden />
            </button>
          )}
          <SharePostMenu
            postId={post.id}
            className="cursor-pointer transition-transform hover:scale-105 hover:text-foreground"
          />
          <span className="ml-auto flex items-center gap-1.5">
            <Eye className="size-5" aria-hidden />
            {post.views}
          </span>
        </div>
      </div>

      {reposting && <RepostDialog post={post} onClose={() => setReposting(false)} />}
    </article>
  )
}
