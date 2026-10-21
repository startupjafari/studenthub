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

/**
 * На месте исходника репоста, который зрителю недоступен: удалён, снят модератором или
 * адресован другой аудитории. Ни автора, ни текста не показываем — сервер их и не отдаёт,
 * а старая цитата из кэша означала бы, что снятый пост живёт дальше в репостах.
 */
export function RepostUnavailable({ className }: { className?: string }) {
  const t = useTranslations('Feed')
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 rounded-xl border-l-2 border-l-muted-foreground/40 bg-muted/30 p-3 text-sm text-muted-foreground',
        className,
      )}
    >
      <Repeat2 className="size-3.5 shrink-0" aria-hidden />
      {t('postUnavailableTitle')}
    </p>
  )
}
