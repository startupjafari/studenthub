'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Bookmark,
  Clock,
  Eye,
  FileText,
  Heart,
  Layers,
  ListTree,
  MessageCircle,
  Repeat2,
} from 'lucide-react'
import {
  ArticleCover,
  extractToc,
  fetchProfileArticle,
  fetchRelatedArticles,
  incrementArticleView,
  nodeText,
  profileContentKeys,
  setArticleLike,
  slugify,
  toggleArticleBookmark,
  type ProfileArticle,
} from '../../../entities/profile-content'
import { REPOST_AUDIENCES_BY_ROLE } from '../../../entities/post'
import { fetchUserById, userKeys } from '../../../entities/user'
import { RepostDialog, useRepost } from '../../../features/repost-post'
import { contentModeration } from '../../../widgets/user-profile'
import { useAppSelector } from '../../../shared/store'
import { Button, EmptyState, MarkdownImage, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import { ArticleComments } from './article-comments'
import { ArticleShareMenu } from './article-share-menu'
import { PILL } from './pill'

// Текст статьи: заголовки разделов — с акцентной чертой слева, как в макете; списки, код и
// таблицы — в общей типографике markdown платформы.
const MD_CLASS = [
  'text-[0.9375rem] leading-relaxed text-foreground',
  '[&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline',
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-l-[3px] [&_h2]:border-primary [&_h2]:pl-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug',
  '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold',
  '[&_h1]:scroll-mt-20 [&_h2]:scroll-mt-20 [&_h3]:scroll-mt-20',
  '[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1',
  '[&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs',
  '[&_table]:my-3 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1',
].join(' ')

// Карточка правой колонки — как блоки ленты.
const ASIDE_CARD = 'rounded-2xl bg-card p-4 ring-1 ring-foreground/10'

const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 id={slugify(nodeText(children))}>{children}</h1>,
  h2: ({ children }) => <h2 id={slugify(nodeText(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(nodeText(children))}>{children}</h3>,
  img: MarkdownImage,
}

/** Куда ведёт «назад» без истории (пришли по ссылке): страница организации или профиль автора. */
function ownerHref(a: ProfileArticle): string {
  if (a.companyId) return `/companies/${a.companyId}`
  if (a.universityPageId) return `/universities/${a.universityPageId}`
  return `/profile/${a.userId}`
}

/**
 * Страница статьи — `/articles/<id>`. Раньше статья открывалась окном поверх профиля: у неё
 * не было адреса, ссылку нельзя было переслать, «назад» закрывал профиль целиком.
 *
 * Слева — сама статья: обложка, метки, текст, теги, ряд действий и обсуждение под ней.
 * Справа (с lg) — оглавление с подсветкой текущего раздела и похожие статьи автора.
 * Видимость решает сервер: невидимая статья — «недоступна», без подробностей.
 */
export function ArticlePageView({ articleId }: { articleId: string }) {
  const t = useTranslations('Article')
  const q = useQuery({
    queryKey: profileContentKeys.article(articleId),
    queryFn: () => fetchProfileArticle(articleId),
    // Недоступная статья повторными запросами доступной не станет.
    retry: false,
  })

  if (q.isPending) return <ArticleSkeleton />
  if (q.isError || !q.data) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center">
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title={t('unavailableTitle')}
          description={t('unavailableText')}
          action={
            <Button asChild variant="outline">
              <Link href="/">{t('toFeed')}</Link>
            </Button>
          }
        />
      </div>
    )
  }
  // Ремонт по id: переход на похожую статью сбрасывает лайк, просмотры и обсуждение.
  return <ArticleBody key={q.data.id} article={q.data} />
}

function ArticleBody({ article: a }: { article: ProfileArticle }) {
  const t = useTranslations('Article')
  const tProfile = useTranslations('Profile')
  const tFeed = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const auth = useAppSelector((s) => s.auth)
  const myId = auth.user?.id ?? null

  const [views, setViews] = useState(a.views)
  const [like, setLike] = useState({ liked: a.liked ?? false, count: a.likesCount ?? 0 })
  const [bookmarked, setBookmarked] = useState(a.bookmarked)
  const [commentCount, setCommentCount] = useState(a.commentCount)
  const [repostDialog, setRepostDialog] = useState(false)
  const commentsRef = useRef<HTMLElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)

  const toc = useMemo(() => extractToc(a.content), [a.content])
  const activeSlug = useActiveHeading(toc.map((h) => h.slug))
  const related = useQuery({
    queryKey: [...profileContentKeys.article(a.id), 'related'],
    queryFn: () => fetchRelatedArticles(a.id),
  })
  // Профиль автора личной статьи — для права модерации комментариев (роль и scope владельца).
  // Модератору без него пункт «Удалить (модерация)» показывать нельзя: решает ранг автора.
  const personal = !a.companyId && !a.universityPageId
  const author = useQuery({
    queryKey: userKeys.detail(a.userId),
    queryFn: () => fetchUserById(a.userId),
    enabled: personal && myId !== a.userId,
    retry: false,
  })
  const moderateComments =
    !!author.data &&
    contentModeration(
      { id: myId, role: auth.role, universityId: auth.universityId, facultyId: auth.facultyId },
      author.data,
    ).comments

  const { audience: repostAudience, repostArticle, isPending: repostPending } = useRepost()
  const canRepost =
    a.status === 'PUBLISHED' &&
    auth.role !== null &&
    (REPOST_AUDIENCES_BY_ROLE[auth.role] ?? []).length > 0

  // Просмотр засчитывается один раз при открытии (сервер считает одного зрителя в сутки).
  useEffect(() => {
    incrementArticleView(a.id)
      .then(setViews)
      .catch(() => {})
  }, [a.id])

  // Оптимистичный лайк с откатом (FRONTEND_RULES §5.5); итог — из ответа сервера.
  function toggleLike(): void {
    const prev = like
    const next = !prev.liked
    setLike({ liked: next, count: Math.max(0, prev.count + (next ? 1 : -1)) })
    setArticleLike(a.id, next)
      .then((res) => {
        setLike({ liked: res.liked, count: res.likesCount })
        qc.setQueryData<ProfileArticle>(profileContentKeys.article(a.id), (old) =>
          old ? { ...old, liked: res.liked, likesCount: res.likesCount } : old,
        )
      })
      .catch((e: unknown) => {
        setLike(prev)
        toast.error(tErr(toApiError(e).code))
      })
  }

  function toggleBookmark(): void {
    const prev = bookmarked
    setBookmarked(!prev)
    toggleArticleBookmark(a.id)
      .then(setBookmarked)
      .catch((e: unknown) => {
        setBookmarked(prev)
        toast.error(tErr(toApiError(e).code))
      })
  }

  function goBack(): void {
    // Пришли по прямой ссылке — истории нет, «назад» ведёт к владельцу статьи.
    if (window.history.length > 1) router.back()
    else router.push(ownerHref(a))
  }

  function toComments(): void {
    commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (a.allowComments) commentInputRef.current?.focus({ preventScroll: true })
  }

  const date = new Date(a.publishedAt ?? a.createdAt).toLocaleDateString(locale)
  const category = a.category ? tProfile(`cat_${a.category}`) : null

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <article className="flex min-w-0 flex-col gap-5">
          {/* Обложка — первой на странице, «назад» лежит на ней в углу. Без обложки кнопка
              стоит отдельной строкой над текстом. */}
          {a.coverUrl || a.coverGradient ? (
            <div className="relative">
              <ArticleCover
                coverUrl={a.coverUrl}
                coverGradient={a.coverGradient}
                title={a.title}
                className="h-48 w-full rounded-2xl sm:h-64 xl:h-72"
              />
              <BackButton
                label={tCommon('goBack')}
                onClick={goBack}
                className="absolute top-3 left-3 bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 focus-visible:ring-white/50"
              />
            </div>
          ) : (
            <BackButton
              label={tCommon('goBack')}
              onClick={goBack}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring/20"
            />
          )}

          <div className="flex flex-col gap-4 sm:px-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {category && (
                <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                  {category}
                </span>
              )}
              {a.status === 'DRAFT' && (
                <span className="rounded-md bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
                  {tProfile('draft')}
                </span>
              )}
              <time dateTime={a.publishedAt ?? a.createdAt}>{date}</time>
              {a.readingMinutes ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" aria-hidden />
                  {tProfile('readingTime', { min: a.readingMinutes })}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Eye className="size-4" aria-hidden />
                {tProfile('viewsCount', { count: views })}
              </span>
            </div>

            <h1 className="text-2xl leading-tight font-bold tracking-tight break-words sm:text-3xl">
              {a.title}
            </h1>
            {a.description && (
              <p className="text-base leading-relaxed text-muted-foreground">{a.description}</p>
            )}

            <div className={cn(MD_CLASS, '[overflow-wrap:anywhere]')}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {a.content}
              </ReactMarkdown>
            </div>

            {a.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {a.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/90"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Действия — те же «таблетки», что в окне поста; просмотры справа. */}
            <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
              <button
                type="button"
                aria-pressed={like.liked}
                aria-label={tFeed('like')}
                title={tFeed('like')}
                onClick={toggleLike}
                disabled={a.status !== 'PUBLISHED'}
                className={cn(
                  PILL,
                  like.liked && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
                )}
              >
                <Heart className={cn('size-[18px]', like.liked && 'fill-current')} aria-hidden />
                {like.count > 0 && <span className="font-medium tabular-nums">{like.count}</span>}
              </button>
              <button
                type="button"
                aria-label={tFeed('comment')}
                title={tFeed('comment')}
                onClick={toComments}
                className={PILL}
              >
                <MessageCircle className="size-[18px] -scale-x-100" aria-hidden />
                {commentCount > 0 && (
                  <span className="font-medium tabular-nums">{commentCount}</span>
                )}
              </button>
              {canRepost && (
                <button
                  type="button"
                  aria-label={tFeed('repost')}
                  title={tFeed('repost')}
                  disabled={repostPending}
                  onClick={() => (repostAudience ? repostArticle(a.id) : setRepostDialog(true))}
                  className={PILL}
                >
                  <Repeat2 className="size-[18px]" aria-hidden />
                </button>
              )}
              <ArticleShareMenu
                articleId={a.id}
                title={a.title}
                className={cn(PILL, '[&_svg]:size-[18px]')}
              />
              {/* На узком экране правой колонки рядом нет — закладка встаёт в ряд действий. */}
              <button
                type="button"
                aria-pressed={bookmarked}
                aria-label={bookmarked ? tProfile('bookmarked') : tProfile('bookmark')}
                title={bookmarked ? tProfile('bookmarked') : tProfile('bookmark')}
                onClick={toggleBookmark}
                className={cn(
                  PILL,
                  'lg:hidden',
                  bookmarked && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
                )}
              >
                <Bookmark className={cn('size-[18px]', bookmarked && 'fill-current')} aria-hidden />
              </button>
              <span
                className="ml-auto flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground tabular-nums"
                title={tProfile('viewsCount', { count: views })}
              >
                <Eye className="size-4" aria-hidden />
                {views.toLocaleString(locale)}
              </span>
            </div>

            <section ref={commentsRef} className="scroll-mt-20">
              {a.allowComments ? (
                <ArticleComments
                  articleId={a.id}
                  ownerId={a.userId}
                  moderate={moderateComments}
                  inputRef={commentInputRef}
                  onCount={setCommentCount}
                />
              ) : (
                <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <MessageCircle className="size-4 -scale-x-100" aria-hidden />
                  {t('commentsOff')}
                </p>
              )}
            </section>
          </div>
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
          {/* Закладка и «поделиться» — над оглавлением, едут вместе с колонкой. */}
          <div className={cn(ASIDE_CARD, 'flex gap-2 p-3 max-lg:hidden')}>
            <Button
              type="button"
              variant={bookmarked ? 'secondary' : 'outline'}
              size="md"
              aria-pressed={bookmarked}
              onClick={toggleBookmark}
              className={cn('flex-1 rounded-xl', bookmarked && 'text-primary')}
            >
              <Bookmark className={cn(bookmarked && 'fill-current')} aria-hidden />
              {bookmarked ? tProfile('bookmarked') : tProfile('bookmark')}
            </Button>
            <ArticleShareMenu
              articleId={a.id}
              title={a.title}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-input bg-background transition-colors duration-150 hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none dark:bg-input/30 dark:hover:bg-input/50"
            />
          </div>
          {/* Оглавление — только рядом с текстом: на телефоне оно ушло бы под статью. */}
          {toc.length > 1 && (
            <nav
              aria-label={tProfile('tableOfContents')}
              className={cn(ASIDE_CARD, 'max-lg:hidden')}
            >
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ListTree className="size-4 text-muted-foreground" aria-hidden />
                {tProfile('tableOfContents')}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {toc.map((h, i) => (
                  <li key={`${h.slug}-${i}`} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
                    <a
                      href={`#${h.slug}`}
                      aria-current={activeSlug === h.slug ? 'location' : undefined}
                      onClick={(e) => {
                        e.preventDefault()
                        document
                          .getElementById(h.slug)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                      className={cn(
                        'block rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                        activeSlug === h.slug
                          ? 'bg-primary/15 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {(related.data?.length ?? 0) > 0 && (
            <section className={ASIDE_CARD}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-muted-foreground" aria-hidden />
                {tProfile('relatedArticles')}
              </h2>
              <ul className="flex flex-col divide-y divide-border">
                {(related.data ?? []).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/articles/${r.id}`}
                      // Похожие приходят с текстом — странице не нужно просить его заново.
                      onClick={() => qc.setQueryData(profileContentKeys.article(r.id), r)}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 hover:bg-muted/60"
                    >
                      <ArticleCover
                        coverUrl={r.coverUrl}
                        coverGradient={r.coverGradient}
                        title={r.title}
                        letter
                        className="h-14 w-20 shrink-0 rounded-lg"
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="line-clamp-2 text-sm leading-snug font-medium">
                          {r.title}
                        </span>
                        <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                          {r.readingMinutes ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3.5" aria-hidden />
                              {tProfile('readingTime', { min: r.readingMinutes })}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1">
                            <Eye className="size-3.5" aria-hidden />
                            {r.views.toLocaleString(locale)}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {repostDialog && (
        <RepostDialog
          article={{ id: a.id, title: a.title }}
          onClose={() => setRepostDialog(false)}
        />
      )}
    </div>
  )
}

/** «Назад» — кружок; на обложке тёмный полупрозрачный, без неё — обычный. */
function BackButton({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-4 focus-visible:outline-none',
        className,
      )}
    >
      <ArrowLeft className="size-5" aria-hidden />
    </button>
  )
}

/**
 * Раздел, который сейчас читают: последний заголовок, ушедший выше верхней трети экрана.
 * Подсвечивает пункт оглавления — как в макете.
 */
function useActiveHeading(slugs: string[]): string | null {
  const [active, setActive] = useState<string | null>(slugs[0] ?? null)
  const key = slugs.join('|')
  useEffect(() => {
    if (slugs.length === 0) return
    const update = (): void => {
      const line = window.innerHeight / 3
      let current = slugs[0] ?? null
      for (const slug of slugs) {
        const el = document.getElementById(slug)
        if (el && el.getBoundingClientRect().top <= line) current = slug
      }
      setActive(current)
    }
    update()
    // Прокручивается не окно, а область контента оболочки: слушаем все прокрутки (capture).
    document.addEventListener('scroll', update, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', update, { capture: true })
    // Набор заголовков задаёт key: массив slugs новый на каждой отрисовке.
  }, [key])
  return active
}

function ArticleSkeleton() {
  return (
    <div className="flex w-full flex-1 flex-col gap-4" aria-busy>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-48 w-full rounded-2xl sm:h-64 xl:h-72" />
          <div className="flex flex-col gap-3 sm:px-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-2xl max-lg:hidden" />
      </div>
    </div>
  )
}
