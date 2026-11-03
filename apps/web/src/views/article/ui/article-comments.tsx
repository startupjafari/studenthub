'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronDown, Loader2, MessageCircle, SendHorizontal, Smile } from 'lucide-react'
import {
  addArticleComment,
  deleteArticleComment,
  fetchArticleComments,
  profileContentKeys,
  type ContentComment,
  type ContentCommentsPage,
} from '../../../entities/profile-content'
import { ProfileLink } from '../../../entities/user'
import { useAppSelector } from '../../../shared/store'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { relativeTime, toApiError } from '../../../shared/lib'

// Быстрый набор эмодзи — как в комментариях поста.
const EMOJI_SET = [
  '😀',
  '😂',
  '😍',
  '🥰',
  '😎',
  '🤩',
  '😅',
  '😊',
  '👍',
  '👏',
  '🙌',
  '🔥',
  '❤️',
  '💯',
  '🎉',
  '✨',
  '😮',
  '🤔',
  '🙏',
  '💪',
  '✅',
  '⭐',
  '😢',
  '😉',
]

// Ряды скелетона, пока грузится обсуждение: место под список держится заранее.
const SKELETON_ROWS = 3

function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

/**
 * Обсуждение под статьёй — в том же виде, что в окне поста: «Комментарии (N)» с порядком,
 * поле ввода, реплики (аватар, имя с меткой автора и временем, текст, действия).
 *
 * Поле ввода — над списком, а не под ним: на странице статьи обсуждение длинное, и под
 * сотней реплик поле пришлось бы искать прокруткой. Ответов у статьи нет — реплики плоские.
 * Удалить свою реплику может её автор, любую — владелец статьи; модератор scope — через
 * подтверждение (ранг автора реплики сверяет сервер).
 */
export function ArticleComments({
  articleId,
  ownerId,
  moderate,
  inputRef,
  onCount,
}: {
  articleId: string
  ownerId: string
  moderate: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  /** Сколько комментариев всего — для счётчика в ряду действий. */
  onCount: (count: number) => void
}) {
  const t = useTranslations('Feed')
  const tProfile = useTranslations('Profile')
  const tArticle = useTranslations('Article')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const queryKey = [...profileContentKeys.article(articleId), 'comments']

  const [text, setText] = useState('')
  const [newestFirst, setNewestFirst] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [freshId, setFreshId] = useState<string | null>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchArticleComments(articleId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })

  const loaded = [
    ...new Map((q.data?.pages ?? []).flatMap((page) => page.items).map((c) => [c.id, c])).values(),
  ].sort((a, b) =>
    newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
  )
  // Заголовок — из общего числа на сервере, а не по длине загруженного.
  const total = q.data?.pages[0]?.total ?? loaded.length
  useEffect(() => {
    if (q.data) onCount(total)
  }, [q.data, total, onCount])

  // Правка кэша обсуждения: первая страница — самые свежие, `total` живёт в ней же.
  function patchPages(edit: (pages: ContentCommentsPage[]) => ContentCommentsPage[]): void {
    qc.setQueryData<InfiniteData<ContentCommentsPage>>(queryKey, (old) =>
      old ? { ...old, pages: edit(old.pages) } : old,
    )
  }
  const shiftTotal = (page: ContentCommentsPage, delta: number): ContentCommentsPage =>
    page.total === undefined ? page : { ...page, total: Math.max(0, page.total + delta) }

  const err = (e: unknown): void => void toast.error(tErr(toApiError(e).code))
  const addMut = useMutation({
    mutationFn: () => addArticleComment(articleId, text.trim()),
    // Сервер вернул реплику целиком — дописываем её сами, без перезапроса списка.
    onSuccess: (created) => {
      patchPages((pages) =>
        pages.map((page, i) =>
          i === 0 ? shiftTotal({ ...page, items: [created, ...page.items] }, 1) : page,
        ),
      )
      setFreshId(created.id)
      setText('')
    },
    onError: err,
  })
  const delMut = useMutation({
    mutationFn: (commentId: string) => deleteArticleComment(articleId, commentId),
    onSuccess: (_, commentId) =>
      patchPages((pages) =>
        pages.map((page, i) => {
          const items = page.items.filter((c) => c.id !== commentId)
          return i === 0 ? shiftTotal({ ...page, items }, -1) : { ...page, items }
        }),
      ),
    onError: err,
  })

  // Отправка — не чаще одной за раз: isPending приходит в рендер не сразу, и быстрый второй
  // Enter успевал отправить тот же комментарий ещё раз.
  const sendingRef = useRef(false)
  function send(): void {
    if (sendingRef.current || text.trim().length === 0) return
    sendingRef.current = true
    addMut.mutate(undefined, {
      onSettled: () => {
        sendingRef.current = false
      },
    })
  }

  function remove(c: ContentComment): void {
    if (c.authorId === myId || ownerId === myId) {
      delMut.mutate(c.id)
      return
    }
    void confirm({
      title: tProfile('commentDeleteConfirm'),
      description: tProfile('moderationDeleteHint'),
      confirmLabel: tProfile('deleteModeration'),
      destructive: true,
    }).then((ok) => {
      if (ok) delMut.mutate(c.id)
    })
  }

  // Авто-высота поля ввода (перенос строки — Shift+Enter).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text, inputRef])

  // Пикер эмодзи закрывается кликом вне его и по Esc.
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: MouseEvent): void => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [emojiOpen])

  function insertEmoji(emoji: string): void {
    const el = inputRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      const pos = start + emoji.length
      el?.setSelectionRange(pos, pos)
    })
  }

  const earlier = q.hasNextPage && (
    <button
      type="button"
      onClick={() => void q.fetchNextPage()}
      disabled={q.isFetchingNextPage}
      className="flex cursor-pointer items-center gap-3 self-start text-xs font-semibold text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-60"
    >
      <span aria-hidden className="h-px w-6 bg-muted-foreground/50" />
      {q.isFetchingNextPage ? t('loadingComments') : t('showEarlierComments')}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('commentsHeading', { count: total })}</h2>
        {total > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-mr-1.5 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                {newestFirst ? t('sortNewest') : t('sortOldest')}
                <ChevronDown className="size-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={newestFirst ? 'newest' : 'oldest'}
                onValueChange={(v) => setNewestFirst(v === 'newest')}
              >
                <DropdownMenuRadioItem value="oldest">{t('sortOldest')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="newest">{t('sortNewest')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Эмодзи · многострочное поле · отправка — по нижней кромке: поле растёт вверх. */}
      <div className="relative flex items-end gap-2">
        <div ref={emojiRef} className="relative shrink-0">
          <button
            type="button"
            aria-label={t('emoji')}
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((o) => !o)}
            className={cn(
              'flex size-10 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
              emojiOpen && 'bg-muted text-foreground',
            )}
          >
            <Smile className="size-5" aria-hidden />
          </button>
          {emojiOpen && (
            <div className="absolute top-full left-0 z-30 mt-2 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-border bg-popover p-2 shadow-lg">
              {EMOJI_SET.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => insertEmoji(e)}
                  className="flex size-7 items-center justify-center rounded-md text-lg transition-colors hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 rounded-xl bg-muted/60 px-3.5 ring-1 ring-transparent transition-shadow duration-150 focus-within:ring-ring/40">
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter — отправить; Shift+Enter — перенос строки.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={t('writeComment')}
            aria-label={t('writeComment')}
            className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-sm leading-snug outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={text.trim().length === 0 || addMut.isPending}
          aria-busy={addMut.isPending}
          aria-label={t('send')}
          title={t('send')}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground transition-[background-color,opacity] duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
        >
          {addMut.isPending ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <SendHorizontal className="size-[18px]" aria-hidden />
          )}
        </button>
      </div>

      {q.isLoading ? (
        <ul className="flex flex-col gap-4" aria-label={t('loadingComments')} aria-busy>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <li key={i} className="flex gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3.5 w-4/5" />
              </div>
            </li>
          ))}
        </ul>
      ) : q.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <p className="text-muted-foreground">{t('commentsError')}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            {tCommon('retry')}
          </Button>
        </div>
      ) : loaded.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <MessageCircle className="size-5 -scale-x-100" aria-hidden />
          </span>
          <p className="max-w-60">{t('commentsEmpty')}</p>
        </div>
      ) : (
        <>
          {!newestFirst && earlier}
          <ul className="flex flex-col gap-5">
            {loaded.map((c) => {
              const canDelete = c.authorId === myId || ownerId === myId || moderate
              return (
                <li
                  key={c.id}
                  className={cn(
                    'group flex gap-3',
                    c.id === freshId &&
                      'animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none',
                  )}
                >
                  <ProfileLink userId={c.author.id} className="shrink-0 rounded-full">
                    <Avatar className="size-9">
                      {c.author.avatarUrl && <AvatarImage src={c.author.avatarUrl} alt="" />}
                      <AvatarFallback className="text-[10px]">{initials(c.author)}</AvatarFallback>
                    </Avatar>
                  </ProfileLink>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-1.5 text-sm leading-snug">
                      <ProfileLink
                        userId={c.author.id}
                        className="truncate font-semibold transition-colors duration-150 hover:text-primary"
                      >
                        {c.author.lastName} {c.author.firstName}
                      </ProfileLink>
                      {c.authorId === ownerId && (
                        <span className="shrink-0 rounded bg-primary px-1.5 py-px text-[11px] font-medium text-primary-foreground">
                          {tArticle('authorTag')}
                        </span>
                      )}
                      <time
                        dateTime={c.createdAt}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        {relativeTime(c.createdAt, locale)}
                      </time>
                    </p>
                    <p className="mt-0.5 text-sm leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {c.content}
                    </p>
                    {canDelete && (
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          className="-mx-1 cursor-pointer rounded px-1 py-1 opacity-0 transition-[opacity,color] duration-150 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none max-md:opacity-100"
                        >
                          {c.authorId === myId || ownerId === myId
                            ? t('delete')
                            : tProfile('deleteModeration')}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {newestFirst && earlier}
        </>
      )}
    </div>
  )
}
