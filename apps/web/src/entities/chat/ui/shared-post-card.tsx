'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Heart, MessageSquare, Paperclip } from 'lucide-react'
import type { SharedPostPreview } from '../model/types'

// Превью-карточка расшаренного в чат поста: автор, сниппет, счётчики. Ведёт на профиль автора
// (отдельного роута поста нет). Медиа поста, как и в ленте, показываем счётчиком, не миниатюрой.
export function SharedPostCard({ post }: { post: SharedPostPreview }) {
  const t = useTranslations('Feed')

  if (post.deletedAt) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {t('postUnavailable')}
      </div>
    )
  }

  const name = `${post.author.lastName} ${post.author.firstName}`.trim()
  return (
    <Link
      href={`/profile/${post.authorId}`}
      className="block rounded-xl border border-border bg-card p-3 text-foreground transition-colors hover:border-ring/50"
    >
      <p className="mb-1 truncate text-xs font-semibold">{name}</p>
      {post.content && (
        <p className="line-clamp-3 text-sm whitespace-pre-wrap text-foreground">{post.content}</p>
      )}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Heart className="size-3" aria-hidden />
          {post._count.reactions}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" aria-hidden />
          {post._count.comments}
        </span>
        {post.media.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="size-3" aria-hidden />
            {post.media.length}
          </span>
        )}
      </div>
    </Link>
  )
}
