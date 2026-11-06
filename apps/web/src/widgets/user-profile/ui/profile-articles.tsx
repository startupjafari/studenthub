'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ArticleCategory } from '@studenthub/shared-schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Bookmark, Clock, Eye, FileText, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import {
  ArticleCover,
  deleteProfileArticle,
  fetchProfileArticle,
  profileContentKeys,
  type ProfileArticleCard,
} from '../../../entities/profile-content'
import {
  Button,
  EmptyState,
  MosaicGrid,
  MosaicTile,
  Skeleton,
  mosaicShape,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ArticleEditorModal } from './article-editor-modal'
import { ContentModal } from './content-modal'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'
import { LoadFailed } from './load-failed'
import { useProgressive } from './use-progressive'
import type { ContentModeration } from '../lib/content-moderation'
import { useOwnerKey } from '../lib/content-owner'
import { ownerArticlesQuery } from '../lib/owner-queries'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  userId: string
  isOwner: boolean
  moderation?: ContentModeration
  openCreate?: number
  onConsumed?: () => void
}

export function ProfileArticles({ userId, isOwner, moderation, openCreate, onConsumed }: Props) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<ProfileArticleCard | 'new' | null>(null)

  useEffect(() => {
    if (openCreate === undefined) return
    setEditing('new')
    onConsumed?.()
  }, [openCreate])

  // Страница компании — её статьи; иначе — статьи пользователя userId.
  const { owner, key: ownerKey } = useOwnerKey(userId)
  const q = useQuery(ownerArticlesQuery(owner))
  // Ошибка — один тост и повторы с растущей паузой; не помогло — ошибка на месте вкладки.
  const loadState = useRetryOnError(q, t('loadRetry'))

  const delMut = useMutation({
    mutationFn: deleteProfileArticle,
    onSuccess: () => void qc.invalidateQueries({ queryKey: profileContentKeys.articles(ownerKey) }),
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const [sort, setSort] = useState<'new' | 'popular'>('new')
  const [statusFilter, setStatusFilter] = useState<'all' | 'PUBLISHED' | 'DRAFT'>('all')
  const [category, setCategory] = useState<string>('all')

  const articles = q.data ?? []
  const categories = useMemo(
    () =>
      Array.from(
        new Set(articles.map((a) => a.category).filter((c): c is ArticleCategory => c != null)),
      ),
    [articles],
  )
  const visible = useMemo(() => {
    let list = articles
    if (isOwner && statusFilter !== 'all') list = list.filter((a) => a.status === statusFilter)
    if (category !== 'all') list = list.filter((a) => a.category === category)
    return [...list].sort((a, b) => {
      if (sort === 'popular') return b.views - a.views
      const da = new Date(a.publishedAt ?? a.createdAt).getTime()
      const db = new Date(b.publishedAt ?? b.createdAt).getTime()
      return db - da
    })
  }, [articles, isOwner, statusFilter, category, sort])
  // Порция — полный цикл мозаики: догрузка достраивает узор, а не обрывает его.
  const { shown, pending, sentinelRef } = useProgressive(
    visible.length,
    14,
    `${statusFilter}|${category}|${sort}`,
  )

  const modals = (
    <>
      {editing === 'new' && (
        <ArticleEditorModal userId={userId} initial={null} onClose={() => setEditing(null)} />
      )}
      {editing !== null && editing !== 'new' && (
        <ArticleEditLoader userId={userId} card={editing} onClose={() => setEditing(null)} />
      )}
    </>
  )

  if (!q.data && loadState.failed) {
    return (
      <>
        {modals}
        <LoadFailed onRetry={loadState.retry} busy={q.isFetching} />
      </>
    )
  }
  if (!q.data) {
    return (
      <>
        {modals}
        <ContentLayout sidebar={<FilterSkeleton groups={3} />}>
          <MosaicGrid aria-hidden>
            {Array.from({ length: 14 }).map((_, i) => (
              <MosaicTile key={i} index={i}>
                <Skeleton className="size-full rounded-none" />
              </MosaicTile>
            ))}
          </MosaicGrid>
        </ContentLayout>
      </>
    )
  }
  if (articles.length === 0) {
    return (
      <>
        {modals}
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title={t('articlesEmpty')}
          className="min-h-[calc(100dvh_-_20rem)]"
        />
      </>
    )
  }

  const sidebar = (
    <>
      <FilterGroup title={t('sortBy')}>
        <FilterOption active={sort === 'new'} onClick={() => setSort('new')} label={t('sortNew')} />
        <FilterOption
          active={sort === 'popular'}
          onClick={() => setSort('popular')}
          label={t('sortPopular')}
        />
      </FilterGroup>
      {isOwner && (
        <FilterGroup title={t('filterBy')}>
          <FilterOption
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            label={t('filterAll')}
          />
          <FilterOption
            active={statusFilter === 'PUBLISHED'}
            onClick={() => setStatusFilter('PUBLISHED')}
            label={t('filterPublished')}
          />
          <FilterOption
            active={statusFilter === 'DRAFT'}
            onClick={() => setStatusFilter('DRAFT')}
            label={t('filterDrafts')}
          />
        </FilterGroup>
      )}
      {categories.length > 0 && (
        <FilterGroup title={t('categoryLabel')}>
          <FilterOption
            active={category === 'all'}
            onClick={() => setCategory('all')}
            label={t('filterAll')}
          />
          {categories.map((c) => (
            <FilterOption
              key={c}
              active={category === c}
              onClick={() => setCategory(c)}
              label={t(`cat_${c}`)}
            />
          ))}
        </FilterGroup>
      )}
    </>
  )

  return (
    <>
      {modals}
      <ContentLayout sidebar={sidebar}>
        <div className="flex flex-1 flex-col gap-4">
          {visible.length === 0 ? (
            <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('nothingFound')}
            </p>
          ) : (
            <MosaicGrid>
              {visible.slice(0, shown).map((a, i) => (
                <ArticleCard
                  key={a.id}
                  index={i}
                  article={a}
                  isOwner={isOwner}
                  canModerate={!isOwner && !!moderation?.content}
                  onEdit={() => setEditing(a)}
                  onDelete={() => {
                    void confirm({ title: t('articleDeleteConfirm'), destructive: true }).then(
                      (ok) => {
                        if (ok) delMut.mutate(a.id)
                      },
                    )
                  }}
                  onModerate={() => {
                    void confirm({
                      title: t('articleDeleteConfirm'),
                      description: t('moderationDeleteHint'),
                      confirmLabel: t('deleteModeration'),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) delMut.mutate(a.id)
                    })
                  }}
                />
              ))}
              {Array.from({ length: pending }, (_, j) => (
                <MosaicTile
                  key={`pending-${j}`}
                  ref={j === 0 ? sentinelRef : undefined}
                  index={shown + j}
                  aria-hidden
                >
                  <Skeleton className="size-full rounded-none" />
                </MosaicTile>
              ))}
            </MosaicGrid>
          )}
        </div>
      </ContentLayout>
    </>
  )
}

// Плитка статьи в мозаике: обложка во всю плитку, рубрика, заголовок и мета — на затемнении
// снизу (читаются поверх любого снимка). Подзаголовок помещается только в высокую плитку.
function ArticleCard({
  index,
  article: a,
  isOwner,
  canModerate,
  onEdit,
  onDelete,
  onModerate,
}: {
  index: number
  article: ProfileArticleCard
  isOwner: boolean
  // Модератор scope: вместо «Изменить/Удалить» владельца — один пункт «Удалить (модерация)».
  canModerate: boolean
  onEdit: () => void
  onDelete: () => void
  onModerate: () => void
}) {
  const t = useTranslations('Profile')
  const shape = mosaicShape(index)

  return (
    <MosaicTile index={index}>
      {/* Статья открывается своей страницей (/articles/<id>), а не окном: у неё есть
          адрес — его можно переслать, открыть в новой вкладке и вернуться назад. */}
      <Link
        href={`/articles/${a.id}`}
        className="absolute inset-0 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:ring-inset"
      >
        <ArticleCover
          coverUrl={a.coverUrl}
          coverGradient={a.coverGradient}
          title={a.title}
          // Заголовок и так стоит внизу плитки — градиентной обложке хватает буквы.
          letter
          className="size-full transition-transform duration-(--motion-large) group-hover/tile:scale-[1.03] motion-reduce:transition-none"
        />
        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pt-10 pb-3 text-white">
          <span className="flex flex-wrap items-center gap-1.5 max-sm:hidden">
            {a.status === 'DRAFT' && (
              <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
                {t('draft')}
              </span>
            )}
            {a.category && (
              <span className="rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-medium">
                {t(`cat_${a.category}`)}
              </span>
            )}
          </span>
          <span
            className={cn(
              'font-semibold leading-snug',
              shape === 'square' ? 'line-clamp-2 text-sm max-sm:text-xs' : 'line-clamp-3 text-base',
            )}
          >
            {a.title}
          </span>
          {shape === 'tall' && a.description && (
            <span className="line-clamp-3 text-xs leading-relaxed text-white/80">
              {a.description}
            </span>
          )}
          <span className="flex items-center gap-3 text-xs font-medium text-white/85 tabular-nums max-sm:hidden">
            {a.readingMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {t('readingTime', { min: a.readingMinutes })}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" aria-hidden />
              {a.views}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" aria-hidden />
              {a.commentCount}
            </span>
            {a.bookmarked && (
              <Bookmark className="ml-auto size-3.5 fill-current" aria-label={t('bookmarked')} />
            )}
          </span>
        </span>
      </Link>

      {isOwner && (
        <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100 max-lg:opacity-100">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon
            aria-label={t('edit')}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon
            aria-label={t('delete')}
            onClick={onDelete}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      )}
      {canModerate && (
        <div className="absolute right-2 top-2 z-10 flex opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100 max-lg:opacity-100">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon
            aria-label={t('deleteModeration')}
            title={t('deleteModeration')}
            onClick={onModerate}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      )}
    </MosaicTile>
  )
}

/** Статья целиком (с текстом) — по id; список профиля несёт только плитки без текста. */
function useFullArticle(id: string) {
  return useQuery({
    queryKey: profileContentKeys.article(id),
    queryFn: () => fetchProfileArticle(id),
  })
}

// Редактор существующей статьи открывается с полным текстом: в плитке списка его нет.
// Пока текст грузится — то же окно со скелетоном, чтобы нажатие отозвалось сразу.
function ArticleEditLoader({
  userId,
  card,
  onClose,
}: {
  userId: string
  card: ProfileArticleCard
  onClose: () => void
}) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const full = useFullArticle(card.id)
  useEffect(() => {
    if (!full.isError) return
    toast.error(tErr(errCode(full.error)))
    onClose()
  }, [full.isError, full.error, onClose, tErr])
  if (full.data) return <ArticleEditorModal userId={userId} initial={full.data} onClose={onClose} />
  return (
    <ContentModal title={t('editArticle')} onClose={onClose} size="xl">
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    </ContentModal>
  )
}
