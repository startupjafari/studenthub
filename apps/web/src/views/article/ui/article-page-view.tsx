'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, Bookmark, FileText, Heart, MessageCircle, Pencil } from 'lucide-react'
import {
  ArticleContent,
  ArticleCover,
  ArticleHeadline,
  ArticleTableOfContents,
  ReadingProgress,
  extractToc,
  fetchProfileArticle,
  fetchRelatedArticles,
  incrementArticleView,
  profileContentKeys,
  setArticleLike,
  toggleArticleBookmark,
  type ProfileArticle,
} from '../../../entities/profile-content'
import { fetchUserById, userKeys } from '../../../entities/user'
import { contentModeration } from '../../../widgets/user-profile'
import { useAppSelector } from '../../../shared/store'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import { ArticleComments } from './article-comments'
import { ArticleShareMenu } from './article-share-menu'

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
  const articleRef = useRef<HTMLElement>(null)
  const commentsRef = useRef<HTMLElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)

  const toc = useMemo(() => extractToc(a.content), [a.content])
  const related = useQuery({
    queryKey: [...profileContentKeys.article(a.id), 'related'],
    queryFn: () => fetchRelatedArticles(a.id),
  })
  // Профиль автора личной статьи — строка автора и право модерации комментариев (роль и
  // scope владельца): модератору без него пункт «Удалить (модерация)» показывать нельзя.
  const personal = !a.companyId && !a.universityPageId
  const author = useQuery({
    queryKey: userKeys.detail(a.userId),
    queryFn: () => fetchUserById(a.userId),
    enabled: personal,
    retry: false,
  })
  const moderateComments =
    myId !== a.userId &&
    !!author.data &&
    contentModeration(
      { id: myId, role: auth.role, universityId: auth.universityId, facultyId: auth.facultyId },
      author.data,
    ).comments

  const canEdit = personal && a.userId === myId

  // Просмотр засчитывается один раз при открытии (сервер считает одного зрителя в сутки).
  useEffect(() => {
    incrementArticleView(a.id)
      .then(setViews)
      .catch(() => {})
  }, [a.id])

  // Пришли по ссылке на раздел (#якорь) — к нему, когда текст отрисован.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1))
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' })
  }, [])

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

  const date = new Date(a.publishedAt ?? a.createdAt).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const owner = personal
    ? author.data
      ? {
          name: `${author.data.lastName} ${author.data.firstName}`,
          avatarUrl: author.data.avatarUrl ?? null,
        }
      : null
    : (a.company ?? a.universityPage ?? null)
  const ownerName = owner ? ('name' in owner ? owner.name : '') : ''
  const ownerAvatar = owner ? ('avatarUrl' in owner ? owner.avatarUrl : owner.logoUrl) : null
  const relatedList = (related.data ?? []).filter((r) => r.id !== a.id).slice(0, 4)

  // Строка автора: аватар и имя ведут в профиль (или на страницу организации).
  const byline = (
    <div className="flex items-center gap-3">
      <Link
        href={ownerHref(a)}
        className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Avatar className="size-11">
          {ownerAvatar && <AvatarImage src={ownerAvatar} alt="" />}
          <AvatarFallback className="text-xs">{ownerName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="flex min-w-0 flex-col">
        {owner ? (
          <Link
            href={ownerHref(a)}
            className="truncate text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {ownerName}
          </Link>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <time dateTime={a.publishedAt ?? a.createdAt}>{date}</time>
          {a.readingMinutes ? (
            <>
              <span aria-hidden>·</span>
              <span>{tProfile('readingTime', { min: a.readingMinutes })}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{tProfile('viewsCount', { count: views })}</span>
        </p>
      </div>
    </div>
  )

  // Действия — тихим рядом под строкой автора, как в Medium: лайк и комментарии слева,
  // «поделиться», закладка и правка — справа.
  const actions = (
    <div className="flex items-center gap-1 border-y border-border py-1.5">
      <button
        type="button"
        aria-pressed={like.liked}
        aria-label={tFeed('like')}
        title={tFeed('like')}
        onClick={toggleLike}
        disabled={a.status !== 'PUBLISHED'}
        className={cn(QUIET, like.liked && 'text-destructive hover:text-destructive')}
      >
        <Heart
          key={like.liked ? 'on' : 'off'}
          className={cn(
            'size-5',
            like.liked &&
              'fill-current animate-in zoom-in-75 duration-200 motion-reduce:animate-none',
          )}
          aria-hidden
        />
        {like.count > 0 && <span className="tabular-nums">{like.count}</span>}
      </button>
      <button
        type="button"
        aria-label={tFeed('comment')}
        title={tFeed('comment')}
        onClick={toComments}
        className={QUIET}
      >
        <MessageCircle className="size-5 -scale-x-100" aria-hidden />
        {commentCount > 0 && <span className="tabular-nums">{commentCount}</span>}
      </button>
      <div className="ml-auto flex items-center gap-1">
        <ArticleShareMenu
          articleId={a.id}
          title={a.title}
          className={cn(QUIET, '[&_svg]:size-5')}
        />
        <button
          type="button"
          aria-pressed={bookmarked}
          aria-label={bookmarked ? tProfile('bookmarked') : tProfile('bookmark')}
          title={bookmarked ? tProfile('bookmarked') : tProfile('bookmark')}
          onClick={toggleBookmark}
          className={cn(QUIET, bookmarked && 'text-primary hover:text-primary')}
        >
          <Bookmark className={cn('size-5', bookmarked && 'fill-current')} aria-hidden />
        </button>
        {canEdit && (
          <Link
            href={`/articles/${a.id}/edit`}
            aria-label={tProfile('editArticle')}
            title={tProfile('editArticle')}
            className={QUIET}
          >
            <Pencil className="size-5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )

  const relatedEl =
    relatedList.length > 0 ? (
      <section aria-labelledby="related-heading" className="flex flex-col gap-3">
        <h2 id="related-heading" className="text-base font-semibold">
          {tProfile('relatedArticles')}
        </h2>
        <ul className="flex flex-col gap-1">
          {relatedList.map((r) => (
            <li key={r.id}>
              <Link
                href={`/articles/${r.id}`}
                // Похожие приходят с текстом — странице не нужно просить его заново.
                onClick={() => qc.setQueryData(profileContentKeys.article(r.id), r)}
                className="-mx-2 flex items-start gap-3 rounded-xl px-2 py-2 outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {(r.coverUrl || r.coverGradient) && (
                  <ArticleCover
                    coverUrl={r.coverUrl}
                    coverGradient={r.coverGradient}
                    title={r.title}
                    bare
                    className="aspect-[4/3] w-20 shrink-0 rounded-lg object-cover"
                  />
                )}
                <span className="flex min-w-0 flex-col gap-1">
                  {r.category && (
                    <span className="text-[11px] font-semibold tracking-wide text-primary uppercase">
                      {tProfile(`cat_${r.category}`)}
                    </span>
                  )}
                  <span className="line-clamp-2 text-sm leading-snug font-medium">{r.title}</span>
                  {r.readingMinutes ? (
                    <span className="text-xs text-muted-foreground">
                      {tProfile('readingTime', { min: r.readingMinutes })}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ) : null

  return (
    <div className="flex w-full flex-1 flex-col">
      <ReadingProgress target={articleRef} />
      <div className="mx-auto grid w-full max-w-[72rem] items-start gap-10 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="mx-auto flex w-full max-w-[45rem] min-w-0 flex-col gap-8 pb-8">
          <BackButton
            label={tCommon('goBack')}
            onClick={goBack}
            className="-ml-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/20"
          />
          <article ref={articleRef} className="flex flex-col gap-8">
            <ArticleHeadline
              category={a.category}
              title={a.title}
              description={a.description}
              coverUrl={a.coverUrl}
              coverGradient={a.coverGradient}
              badge={
                a.status === 'DRAFT' ? (
                  <span className="rounded-md bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
                    {tProfile('draft')}
                  </span>
                ) : null
              }
              byline={byline}
              actions={actions}
            />
            {/* Содержание на телефоне и планшете — сворачиваемым блоком над текстом. */}
            {toc.length > 1 && (
              <ArticleTableOfContents items={toc} variant="inline" className="xl:hidden" />
            )}
            <ArticleContent content={a.content} anchors />
            {a.tags.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={tProfile('tags')}>
                {a.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full bg-muted px-3 py-1 text-sm text-foreground/90"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            )}
          </article>

          {/* Об авторе — ещё раз под текстом: дочитавшему удобно перейти в профиль. */}
          {owner && (
            <Link
              href={ownerHref(a)}
              className="flex items-center gap-4 rounded-2xl bg-muted/50 p-4 outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Avatar className="size-14">
                {ownerAvatar && <AvatarImage src={ownerAvatar} alt="" />}
                <AvatarFallback>{ownerName.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">{t('writtenBy')}</span>
                <span className="truncate font-semibold">{ownerName}</span>
              </span>
            </Link>
          )}

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

          {/* Похожие на узком экране — после обсуждения, на широком они в колонке справа. */}
          {relatedEl && <div className="border-t border-border pt-6 xl:hidden">{relatedEl}</div>}
        </div>

        {/* Колонка справа — содержание с подсветкой раздела и похожие статьи; липкая. */}
        <aside className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] flex-col gap-8 overflow-y-auto pt-14 xl:flex sh-scroll">
          {toc.length > 1 && <ArticleTableOfContents items={toc} variant="aside" />}
          {relatedEl}
        </aside>
      </div>
    </div>
  )
}

// Тихое действие статьи: без подложки, 44px под палец (40px под курсор).
const QUIET =
  'flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 sm:h-10 sm:min-w-10'

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

function ArticleSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[45rem] flex-1 flex-col gap-6" aria-busy>
      <Skeleton className="size-10 rounded-full" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-10 w-4/5" />
      <Skeleton className="h-5 w-3/5" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3.5 w-48" />
        </div>
      </div>
      <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}
