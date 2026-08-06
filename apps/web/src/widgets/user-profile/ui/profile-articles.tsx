'use client'

import type { ReactNode } from 'react'
import { isValidElement, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArticleCategory } from '@studenthub/shared-schemas'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  Bookmark,
  Clock,
  Eye,
  FileText,
  ListTree,
  MessageCircle,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import {
  addArticleComment,
  deleteArticleComment,
  deleteProfileArticle,
  fetchArticleComments,
  fetchProfileArticles,
  fetchRelatedArticles,
  incrementArticleView,
  profileContentKeys,
  toggleArticleBookmark,
  type ProfileArticle,
} from '../../../entities/profile-content'
import { Badge, Button, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ArticleEditorModal } from './article-editor-modal'
import { ArticleCover } from './article-cover'
import { ContentComments } from './content-comments'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const MD_CLASS =
  'text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_table]:my-2 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5'

interface Props {
  userId: string
  isOwner: boolean
  openCreate?: number
  onConsumed?: () => void
}

export function ProfileArticles({ userId, isOwner, openCreate, onConsumed }: Props) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ProfileArticle | 'new' | null>(null)
  const [reading, setReading] = useState<ProfileArticle | null>(null)

  useEffect(() => {
    if (openCreate === undefined) return
    setEditing('new')
    onConsumed?.()
  }, [openCreate])

  const q = useQuery({
    queryKey: profileContentKeys.articles(userId),
    queryFn: () => fetchProfileArticles(userId),
  })
  // При ошибке — держим скелетон, тост каждые 5 сек и повтор запроса.
  useRetryOnError(q.isError, q.refetch, t('loadRetry'))

  const delMut = useMutation({
    mutationFn: deleteProfileArticle,
    onSuccess: () => void qc.invalidateQueries({ queryKey: profileContentKeys.articles(userId) }),
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

  const modals = (
    <>
      {editing !== null && (
        <ArticleEditorModal
          userId={userId}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {reading && (
        <ArticleReader article={reading} onClose={() => setReading(null)} onOpen={setReading} />
      )}
    </>
  )

  if (q.isLoading || q.isError) {
    return (
      <>
        {modals}
        <ContentLayout sidebar={<FilterSkeleton groups={3} />}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <article
                key={i}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <div className="mt-1 border-t border-border pt-3">
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </article>
            ))}
          </div>
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
          className="min-h-[calc(100vh_-_20rem)]"
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
        <div className="flex flex-col gap-4">
          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('nothingFound')}
            </p>
          ) : (
            // Сетка статей: до 3 карточек в ряд.
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((a) => (
                <ArticleCard
                  key={a.id}
                  article={a}
                  isOwner={isOwner}
                  onRead={() => setReading(a)}
                  onEdit={() => setEditing(a)}
                  onDelete={() => {
                    if (window.confirm(t('articleDeleteConfirm'))) delMut.mutate(a.id)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </ContentLayout>
    </>
  )
}

function ArticleCard({
  article: a,
  isOwner,
  onRead,
  onEdit,
  onDelete,
}: {
  article: ProfileArticle
  isOwner: boolean
  onRead: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Profile')
  const locale = useLocale()
  const date = new Date(a.publishedAt ?? a.createdAt).toLocaleDateString(locale)

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onRead}
        className="flex w-full flex-1 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {(a.coverUrl || a.coverGradient) && (
          <ArticleCover
            coverUrl={a.coverUrl}
            coverGradient={a.coverGradient}
            title={a.title}
            className="aspect-video w-full"
          />
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {a.status === 'DRAFT' && <Badge variant="secondary">{t('draft')}</Badge>}
            {a.category && <Badge variant="default">{t(`cat_${a.category}`)}</Badge>}
          </div>
          <h3 className="line-clamp-2 text-lg font-bold leading-snug tracking-tight transition-colors group-hover:text-primary">
            {a.title}
          </h3>
          {a.description && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {a.description}
            </p>
          )}
          {a.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {a.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-border pt-3 text-[13px] text-muted-foreground">
            <time>{date}</time>
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
              <Bookmark className="ml-auto size-3.5 fill-primary text-primary" aria-hidden />
            )}
          </div>
        </div>
      </button>

      {isOwner && (
        <div className="absolute right-3 top-3 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={t('edit')}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={t('delete')}
            onClick={onDelete}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      )}
    </article>
  )
}

// slug для якорей заголовков (оглавление). Юникод-буквы/цифры → дефисы.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

// Текст из markdown-children (для id заголовков и оглавления).
function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

// Оглавление из markdown (## / ###), с пропуском код-блоков.
function extractToc(md: string): { level: number; text: string; slug: string }[] {
  const out: { level: number; text: string; slug: string }[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line)
    if (m && m[1] && m[2]) out.push({ level: m[1].length, text: m[2], slug: slugify(m[2]) })
  }
  return out
}

// Читалка статьи: обложка + мета + оглавление + полный markdown + похожие статьи.
function ArticleReader({
  article: a,
  onClose,
  onOpen,
}: {
  article: ProfileArticle
  onClose: () => void
  onOpen: (article: ProfileArticle) => void
}) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [views, setViews] = useState(a.views)
  const [bookmarked, setBookmarked] = useState(a.bookmarked)
  const toc = useMemo(() => extractToc(a.content), [a.content])
  const related = useQuery({
    queryKey: [...profileContentKeys.articles(a.userId), 'related', a.id],
    queryFn: () => fetchRelatedArticles(a.id),
  })

  const bookmarkMut = useMutation({
    mutationFn: () => toggleArticleBookmark(a.id),
    onSuccess: (v) => setBookmarked(v),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Засчитываем просмотр один раз при открытии.
  useEffect(() => {
    incrementArticleView(a.id)
      .then(setViews)
      .catch(() => {})
  }, [a.id])

  // Закрытие по Esc + блокировка скролла фона (как в лайтбоксе поста).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const mdComponents: Components = {
    h1: ({ children }) => <h1 id={slugify(nodeText(children))}>{children}</h1>,
    h2: ({ children }) => <h2 id={slugify(nodeText(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={slugify(nodeText(children))}>{children}</h3>,
  }

  function scrollTo(slug: string): void {
    document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (typeof document === 'undefined') return null

  // Вьюер статьи в стиле лайтбокса поста: тёмный фон, крупная панель; слева — статья
  // (обложка/заголовок/оглавление/текст/похожие), справа — панель комментариев.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm animate-in fade-in-0 duration-150 sm:px-6 sm:pt-6 sm:pb-16"
    >
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute right-3 top-3 z-20 flex size-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
      >
        <X className="size-6" aria-hidden />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden bg-background shadow-2xl sm:rounded-2xl md:flex-row"
      >
        {/* Левая колонка — статья (скролл) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {(a.coverUrl || a.coverGradient) && (
            <ArticleCover
              coverUrl={a.coverUrl}
              coverGradient={a.coverGradient}
              title={a.title}
              className="h-52 w-full shrink-0 sm:h-64"
            />
          )}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6 sm:px-8">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
              {a.category && <Badge variant="default">{t(`cat_${a.category}`)}</Badge>}
              <time>{new Date(a.publishedAt ?? a.createdAt).toLocaleDateString(locale)}</time>
              {a.readingMinutes ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" aria-hidden />
                  {t('readingTime', { min: a.readingMinutes })}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Eye className="size-4" aria-hidden />
                {t('viewsCount', { count: views })}
              </span>
              <Button
                type="button"
                variant={bookmarked ? 'default' : 'outline'}
                size="sm"
                className="ml-auto"
                loading={bookmarkMut.isPending}
                onClick={() => bookmarkMut.mutate()}
              >
                <Bookmark className={cn('size-4', bookmarked && 'fill-current')} aria-hidden />
                {bookmarked ? t('bookmarked') : t('bookmark')}
              </Button>
            </div>

            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {a.title}
            </h1>

            {/* Оглавление */}
            {toc.length > 1 && (
              <nav className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ListTree className="size-3.5" aria-hidden />
                  {t('tableOfContents')}
                </p>
                <ul className="flex flex-col gap-1">
                  {toc.map((h, i) => (
                    <li key={`${h.slug}-${i}`} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
                      <button
                        type="button"
                        onClick={() => scrollTo(h.slug)}
                        className="text-left text-sm text-primary hover:underline"
                      >
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            {a.description && (
              <p className="text-base leading-relaxed text-muted-foreground">{a.description}</p>
            )}
            <div className={MD_CLASS}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {a.content}
              </ReactMarkdown>
            </div>
            {a.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Похожие статьи */}
            {(related.data?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-2 border-t border-border pt-5">
                <p className="text-sm font-semibold">{t('relatedArticles')}</p>
                {(related.data ?? []).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpen(r)}
                    className="flex items-center gap-3 rounded-lg border border-border p-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <ArticleCover
                      coverUrl={r.coverUrl}
                      coverGradient={r.coverGradient}
                      title={r.title}
                      letter
                      className="size-12 shrink-0 rounded-md"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{r.title}</span>
                      {r.readingMinutes ? (
                        <span className="text-xs text-muted-foreground">
                          {t('readingTime', { min: r.readingMinutes })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Правая колонка — комментарии (как в лайтбоксе поста) */}
        {a.allowComments && (
          <div className="flex min-h-0 w-full shrink-0 flex-col border-t border-border md:w-96 md:border-l md:border-t-0">
            <header className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
              <MessageCircle className="size-4 text-primary" aria-hidden />
              {t('comments')}
            </header>
            <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
              <ContentComments
                queryKey={profileContentKeys.articles(a.userId).concat('comments', a.id)}
                fetchFn={() => fetchArticleComments(a.id)}
                addFn={(content) => addArticleComment(a.id, content)}
                deleteFn={(commentId) => deleteArticleComment(a.id, commentId)}
                ownerId={a.userId}
              />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
