'use client'

import { useTranslations } from 'next-intl'
import { Repeat2 } from 'lucide-react'
import { ProfileLink } from '../../../entities/user'
import type { FeedPost } from '../../../entities/post'
import { cn } from '../../../shared/lib/utils'

/**
 * Пометка над репостом, как в Instagram: «↻ Репост от Имя», под ней — заметка
 * репостнувшего, если он её оставил. Сам пост под пометкой — исходный: лайк и
 * комментарий уходят его автору, а не тому, кто поделился.
 */
export function RepostBanner({ repost, className }: { repost: FeedPost; className?: string }) {
  const t = useTranslations('Feed')
  const name = `${repost.author.lastName} ${repost.author.firstName}`
  const note = repost.content.trim()

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Repeat2 className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {t.rich('repostedBy', {
            name,
            link: (chunks) => (
              <ProfileLink userId={repost.author.id} className="text-foreground hover:underline">
                {chunks}
              </ProfileLink>
            ),
          })}
        </span>
      </p>
      {/* Заметка — пузырём, как подпись к репосту в Instagram: это слова репостнувшего,
          а не часть исходного поста, и сливаться с его текстом им нельзя. */}
      {note && (
        <p className="w-fit max-w-full rounded-2xl rounded-tl-md bg-muted px-3 py-1.5 text-sm break-words whitespace-pre-wrap">
          {note}
        </p>
      )}
    </div>
  )
}
