'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Clock, FileText } from 'lucide-react'
import type { FeedPost } from '../../../entities/post'
import { ArticleCover } from '../../../entities/profile-content'
import { cn } from '../../../shared/lib/utils'

/**
 * Статья в репосте: обложка, рубрика, заголовок, описание и время чтения — ссылкой на её
 * страницу. Текста в ленте нет: читают статью на `/articles/<id>`, со своей проверкой прав.
 * Карточку сервер отдаёт только тем, кто вправе читать статью; остальным — «Статья
 * недоступна» на месте карточки (черновик, закрытый профиль, чужая аудитория).
 */
export function SharedArticleCard({ post, className }: { post: FeedPost; className?: string }) {
  const t = useTranslations('Article')
  const tProfile = useTranslations('Profile')
  if (!post.sharedArticleId) return null
  const a = post.sharedArticle
  if (!a) {
    return (
      <p
        className={cn(
          'flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground',
          className,
        )}
      >
        <FileText className="size-4 shrink-0" aria-hidden />
        {t('unavailableShort')}
      </p>
    )
  }
  return (
    <Link
      href={`/articles/${a.id}`}
      aria-label={`${t('read')}: ${a.title}`}
      className={cn(
        'group/article flex flex-col overflow-hidden rounded-xl bg-muted/40 ring-1 ring-foreground/10 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-row',
        className,
      )}
    >
      {/* Высоту карточки задаёт текст, а не снимок: обложка лежит слоем во всю свою колонку.
          Иначе вертикальное фото растягивало карточку на полэкрана. */}
      <span className="relative h-40 w-full shrink-0 overflow-hidden sm:h-auto sm:min-h-32 sm:w-44">
        <ArticleCover
          coverUrl={a.coverUrl}
          coverGradient={a.coverGradient}
          title={a.title}
          letter
          className="absolute inset-0 size-full"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          {t('title')}
          {a.category && (
            <span className="rounded-md bg-primary/15 px-1.5 py-px font-medium text-primary">
              {tProfile(`cat_${a.category}`)}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-base leading-snug font-semibold group-hover/article:text-primary">
          {a.title}
        </span>
        {a.description && (
          <span className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {a.description}
          </span>
        )}
        {a.readingMinutes ? (
          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            {tProfile('readingTime', { min: a.readingMinutes })}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
