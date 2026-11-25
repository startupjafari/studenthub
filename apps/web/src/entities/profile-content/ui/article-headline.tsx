'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { ArticleCategory } from '@studenthub/shared-schemas'
import { cn } from '../../../shared/lib/utils'
import { ArticleCover } from './article-cover'

/**
 * Шапка статьи — одна для страницы чтения и предпросмотра в редакторе: категория,
 * заголовок, описание, строка автора, действия и обложка. Обложка — только если автор её
 * выбрал (снимок или градиент): без неё страница начинается с текста, а не с пустого блока.
 */
export function ArticleHeadline({
  category,
  title,
  description,
  coverUrl,
  coverGradient,
  badge,
  byline,
  actions,
  className,
}: {
  category: ArticleCategory | null
  title: string
  description: string | null
  coverUrl: string | null
  coverGradient: string | null
  /** Пометка рядом с категорией — «Черновик». */
  badge?: ReactNode
  /** Автор, дата, время чтения, просмотры. */
  byline?: ReactNode
  /** Ряд действий: лайк, комментарии, репост, поделиться, закладка. */
  actions?: ReactNode
  className?: string
}) {
  const tProfile = useTranslations('Profile')
  return (
    <header className={cn('flex flex-col gap-5', className)}>
      {(category || badge) && (
        <div className="flex flex-wrap items-center gap-2">
          {category && (
            <span className="text-xs font-semibold tracking-wide text-primary uppercase">
              {tProfile(`cat_${category}`)}
            </span>
          )}
          {badge}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <h1 className="text-[2rem] leading-[1.15] font-bold tracking-tight break-words sm:text-[2.5rem]">
          {title}
        </h1>
        {description && (
          <p className="text-lg leading-relaxed text-muted-foreground sm:text-xl">{description}</p>
        )}
      </div>
      {byline}
      {actions}
      {(coverUrl || coverGradient) && (
        <ArticleCover
          coverUrl={coverUrl}
          coverGradient={coverGradient}
          title={title}
          bare
          className="aspect-[16/9] w-full rounded-2xl object-cover"
        />
      )}
    </header>
  )
}
