'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, Eye, FileText, PenLine, RotateCw, SlidersHorizontal } from 'lucide-react'
import type {
  ArticleCategory,
  ContentVisibility,
  CreateProfileArticleInput,
} from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import {
  ArticleContent,
  ArticleHeadline,
  articleStats,
  contentOwnerKey,
  createProfileArticle,
  fetchProfileArticle,
  profileContentKeys,
  updateProfileArticle,
  type ContentOwner,
  type ProfileArticle,
} from '../../../entities/profile-content'
import {
  Button,
  EmptyState,
  RichTextField,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  type MarkdownActionKey,
  type RichTextHandle,
} from '../../../shared/ui'
import {
  contentDraftKey,
  readContentDraft,
  removeContentDraft,
  useErrorToast,
  useLocalDraft,
} from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { AutosaveQueue, type AutosaveState } from '../model/autosave-queue'
import { CoverEditor, type CoverValue } from './cover-editor'
import { EditorSettings, type ArticleSettingsValue } from './editor-settings'

/** Пауза после последней правки до сохранения черновика на сервере. */
const AUTOSAVE_DELAY_MS = 2000

/**
 * Кнопки форматирования статьи: заголовки, списки, цитаты, код, ссылки, картинки, таблицы.
 * Подчёркивания нет намеренно: в markdown его нет, и читалка показала бы его обычным текстом.
 * Остальное работает и с клавиатуры (Ctrl/Cmd+B, `# `, `- `, `> `, ```, `---`).
 */
const ARTICLE_ACTIONS: readonly MarkdownActionKey[] = [
  'bold',
  'italic',
  'strike',
  'code',
  'heading',
  'link',
  'bullet',
  'ordered',
  'quote',
  'image',
  'table',
]

type OwnerKind = ContentOwner['kind']

/** Всё, что редактируется: и черновик на устройстве, и тело запроса строятся из этого. */
interface EditorDraft {
  title: string
  description: string
  content: string
  coverUrl: string
  coverGradient: string
  category: ArticleCategory | ''
  tags: string[]
  visibility: ContentVisibility
  allowComments: boolean
}

function fromArticle(a: ProfileArticle | null): EditorDraft {
  return {
    title: a?.title ?? '',
    description: a?.description ?? '',
    content: a?.content ?? '',
    coverUrl: a?.coverUrl ?? '',
    coverGradient: a?.coverGradient ?? '',
    category: a?.category ?? '',
    tags: a?.tags ?? [],
    visibility: (a?.visibility as ContentVisibility | undefined) ?? 'ALL',
    allowComments: a?.allowComments ?? true,
  }
}

function ownerOf(a: ProfileArticle | null, as: OwnerKind): OwnerKind {
  if (!a) return as
  if (a.companyId) return 'company'
  if (a.universityPageId) return 'university'
  return 'user'
}

/** Ключ кэша списка статей владельца — по ответу сервера (id организации знает он). */
function ownerKeyOf(a: ProfileArticle): string {
  if (a.companyId) return contentOwnerKey({ kind: 'company', id: a.companyId })
  if (a.universityPageId) return contentOwnerKey({ kind: 'university', id: a.universityPageId })
  return contentOwnerKey({ kind: 'user', id: a.userId })
}

function ownerHref(a: ProfileArticle | null, kind: OwnerKind): string {
  if (a?.companyId) return `/companies/${a.companyId}`
  if (a?.universityPageId) return `/universities/${a.universityPageId}`
  return kind === 'user' ? '/profile' : '/'
}

/**
 * Редактор статьи — отдельная страница (`/articles/new`, `/articles/<id>/edit`), а не окно:
 * длинный текст пишут долго, с перерывами, и ему нужны весь экран, адрес и «назад».
 */
export function ArticleEditorView({
  articleId,
  as = 'user',
}: {
  articleId?: string
  as?: OwnerKind
}) {
  const t = useTranslations('Article')
  const q = useQuery({
    queryKey: profileContentKeys.article(articleId ?? ''),
    queryFn: () => fetchProfileArticle(articleId as string),
    enabled: !!articleId,
    retry: false,
    // Пока статью правят, фоновый перезапрос не нужен: редактор берёт её один раз.
    refetchOnWindowFocus: false,
  })
  if (articleId && q.isPending) return <EditorSkeleton />
  if (articleId && (q.isError || !q.data)) {
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
  return <ArticleEditor key={articleId ?? 'new'} initial={q.data ?? null} as={as} />
}

function ArticleEditor({ initial, as }: { initial: ProfileArticle | null; as: OwnerKind }) {
  const t = useTranslations('Article')
  const tProfile = useTranslations('Profile')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const qc = useQueryClient()
  const me = useAppSelector((s) => s.auth.user)
  const { show: showApiError } = useErrorToast('article')
  const editorRef = useRef<RichTextHandle | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  const ownerKind = ownerOf(initial, as)
  const [articleId, setArticleId] = useState<string | null>(initial?.id ?? null)
  const articleIdRef = useRef(articleId)
  const published = initial?.status === 'PUBLISHED'

  // Черновик на устройстве: новая статья — своим ключом до первого сохранения на сервере.
  const newKey = me ? contentDraftKey(me.id, `article:new:${ownerKind}`) : null
  const draftKey = me
    ? contentDraftKey(me.id, articleId ? `article:${articleId}` : `article:new:${ownerKind}`)
    : null
  const serverVersion = useMemo(() => fromArticle(initial), [initial])

  // Черновик на устройстве новее сохранённой версии — восстанавливаем его (вкладку закрыли
  // или перезагрузили до сохранения, у опубликованной статьи правки ещё не выпущены).
  const [restored] = useState(() => {
    if (!draftKey) return null
    const local = readContentDraft<EditorDraft>(draftKey)
    if (!local) return null
    if (!initial) return local.value
    const newer = local.savedAt > Date.parse(initial.updatedAt)
    const differs = JSON.stringify(local.value) !== JSON.stringify(serverVersion)
    return newer && differs ? local.value : null
  })
  const [restoredBanner, setRestoredBanner] = useState(restored !== null)
  const [draft, setDraft] = useState<EditorDraft>(restored ?? serverVersion)
  const [preview, setPreview] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [markdownMode, setMarkdownMode] = useState(false)
  const [saveState, setSaveState] = useState<AutosaveState>('idle')
  // Последняя версия на сервере — у опубликованной статьи «есть невыпущенные правки».
  const [publishedVersion, setPublishedVersion] = useState(() => JSON.stringify(serverVersion))

  const patch = (edit: Partial<EditorDraft>): void => setDraft((d) => ({ ...d, ...edit }))
  const serialized = JSON.stringify(draft)
  const valid = draft.title.trim().length > 0 && draft.content.trim().length > 0
  const isEmpty = !draft.title.trim() && !draft.content.trim() && !draft.description.trim()
  const stats = useMemo(() => articleStats(draft.content), [draft.content])
  const localStatus = useLocalDraft<EditorDraft>(draftKey, draft, { empty: isEmpty })
  const dirtyPublished = published && serialized !== publishedVersion

  const toInput = (d: EditorDraft, status: 'DRAFT' | 'PUBLISHED'): CreateProfileArticleInput => ({
    title: d.title.trim(),
    description: d.description.trim() || undefined,
    content: d.content.trim(),
    coverUrl: d.coverUrl || undefined,
    coverGradient: d.coverGradient || undefined,
    category: d.category || undefined,
    tags: d.tags,
    // Видимость статьи страницы организации ставит сервер; схема требует значение.
    visibility: ownerKind === 'user' ? d.visibility : 'ALL',
    allowComments: d.allowComments,
    status,
  })

  function remember(saved: ProfileArticle): void {
    qc.setQueryData(profileContentKeys.article(saved.id), saved)
    if (articleIdRef.current !== saved.id) {
      articleIdRef.current = saved.id
      setArticleId(saved.id)
      // Адрес — уже правки этой статьи, без перехода: редактор не перемонтируется.
      window.history.replaceState(window.history.state, '', `/articles/${saved.id}/edit`)
      if (newKey) removeContentDraft(newKey)
      void qc.invalidateQueries({ queryKey: profileContentKeys.articles(ownerKeyOf(saved)) })
    }
  }

  // Автосохранение на сервер — только черновику: правка опубликованной статьи сразу
  // ушла бы читателям недописанной. У опубликованной — черновик на устройстве и «Обновить».
  const queueRef = useRef<AutosaveQueue<CreateProfileArticleInput> | null>(null)
  if (!queueRef.current) {
    queueRef.current = new AutosaveQueue<CreateProfileArticleInput>({
      onState: setSaveState,
      save: async (input) => {
        const id = articleIdRef.current
        const saved = id
          ? await updateProfileArticle(id, input)
          : await createProfileArticle(input, { kind: ownerKind, id: '' })
        remember(saved)
      },
    })
    if (initial && !restored) queueRef.current.markSaved(JSON.stringify(serverVersion))
  }
  const queue = queueRef.current

  useEffect(() => {
    if (published || !valid) return
    queue.push(toInput(draft, 'DRAFT'), serialized)
    const timer = setTimeout(() => void queue.flush(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // Версию задаёт `serialized`; `draft` и `toInput` — производные от неё.
  }, [serialized, published, valid, queue])

  // Закрыть вкладку посреди сохранения или с невыпущенными правками — спросить браузером.
  const unsaved =
    saveState === 'pending' || saveState === 'saving' || saveState === 'error' || dirtyPublished
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])

  const publish = useMutation({
    mutationFn: async () => {
      // Летящее автосохранение черновика — сначала дождаться: иначе оно легло бы после
      // публикации и вернуло статью в черновики.
      await queue.stop()
      const input = toInput(draft, 'PUBLISHED')
      const id = articleIdRef.current
      return id
        ? updateProfileArticle(id, input)
        : createProfileArticle(input, { kind: ownerKind, id: '' })
    },
    onSuccess: (saved) => {
      if (draftKey) removeContentDraft(draftKey)
      if (newKey) removeContentDraft(newKey)
      qc.setQueryData(profileContentKeys.article(saved.id), saved)
      void qc.invalidateQueries({ queryKey: profileContentKeys.articles(ownerKeyOf(saved)) })
      setPublishedVersion(serialized)
      toast.success(published ? t('updated') : t('publishedOk'))
      router.replace(`/articles/${saved.id}`)
    },
    onError: (e) => {
      queue.resume()
      showApiError(e)
    },
  })

  function goBack(): void {
    if (window.history.length > 1) router.back()
    else router.push(ownerHref(initial, ownerKind))
  }

  function discardRestored(): void {
    if (draftKey) removeContentDraft(draftKey)
    setDraft(serverVersion)
    setRestoredBanner(false)
  }

  const settings: ArticleSettingsValue = {
    category: draft.category,
    tags: draft.tags,
    visibility: draft.visibility,
    allowComments: draft.allowComments,
  }
  const settingsPanel = (
    <EditorSettings
      value={settings}
      onChange={(next) => patch(next)}
      owner={ownerKind}
      stats={stats}
      markdownMode={markdownMode}
      onMarkdownMode={setMarkdownMode}
    />
  )

  return (
    <div className="flex w-full flex-1 flex-col">
      {/* Верхняя панель: назад, состояние сохранения, предпросмотр, главное действие. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:-mt-6 md:px-6">
        <button
          type="button"
          onClick={goBack}
          aria-label={tCommon('goBack')}
          title={tCommon('goBack')}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <SaveStatus
          state={saveState}
          local={localStatus}
          published={published}
          dirtyPublished={dirtyPublished}
          valid={valid}
          empty={isEmpty}
          onRetry={() => void queue.flush()}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="md"
            aria-pressed={preview}
            onClick={() => setPreview((v) => !v)}
            className="rounded-full"
          >
            {preview ? (
              <PenLine className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
            <span className="max-sm:hidden">{preview ? t('backToEditing') : t('preview')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('settings')}
            title={t('settings')}
            onClick={() => setSettingsOpen(true)}
            className="rounded-full lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="md"
            loading={publish.isPending}
            disabled={!valid || (published && !dirtyPublished)}
            title={valid ? undefined : t('publishHint')}
            onClick={() => publish.mutate()}
            className="rounded-full px-4"
          >
            {published ? t('update') : tProfile('publish')}
          </Button>
        </div>
      </div>

      {restoredBanner && (
        <div className="mx-auto mt-4 flex w-full max-w-[45rem] items-center gap-3 rounded-xl bg-info/10 px-4 py-2.5 text-sm text-info">
          <span className="flex-1">{t('draftRestored')}</span>
          <button
            type="button"
            onClick={discardRestored}
            className="shrink-0 cursor-pointer font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {initial ? t('restoreSaved') : t('startOver')}
          </button>
          <button
            type="button"
            onClick={() => setRestoredBanner(false)}
            className="shrink-0 cursor-pointer font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {t('keepRestored')}
          </button>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[72rem] items-start gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="mx-auto flex w-full max-w-[45rem] min-w-0 flex-col gap-6">
          {preview ? (
            // Предпросмотр — те же компоненты, что у страницы статьи.
            <article className="flex flex-col gap-8">
              <ArticleHeadline
                category={draft.category || null}
                title={draft.title || t('untitled')}
                description={draft.description || null}
                coverUrl={draft.coverUrl || null}
                coverGradient={draft.coverGradient || null}
                byline={
                  <p className="text-sm text-muted-foreground">
                    {me ? `${me.lastName} ${me.firstName}` : ''}
                    {stats.minutes > 0 && ` · ${tProfile('readingTime', { min: stats.minutes })}`}
                  </p>
                }
              />
              <ArticleContent content={draft.content} />
              {draft.tags.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {draft.tags.map((tag) => (
                    <li key={tag} className="rounded-full bg-muted px-3 py-1 text-sm">
                      #{tag}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ) : (
            <>
              <CoverEditor
                value={{ coverUrl: draft.coverUrl, coverGradient: draft.coverGradient }}
                title={draft.title}
                onChange={(cover: CoverValue) => patch(cover)}
              />
              <AutoGrowTextarea
                value={draft.title}
                onChange={(title) => patch({ title })}
                onEnter={() => descriptionRef.current?.focus()}
                maxLength={200}
                aria-label={tProfile('articleTitle')}
                placeholder={t('titlePlaceholder')}
                className="text-[2rem] leading-[1.15] font-bold tracking-tight sm:text-[2.5rem]"
                autoFocus={!initial}
              />
              <AutoGrowTextarea
                ref={descriptionRef}
                value={draft.description}
                onChange={(description) => patch({ description })}
                onEnter={() => editorRef.current?.focus()}
                maxLength={300}
                aria-label={tProfile('articleDescription')}
                placeholder={t('descriptionPlaceholder')}
                className="-mt-3 text-lg leading-relaxed text-muted-foreground sm:text-xl"
              />
              {markdownMode ? (
                <AutoGrowTextarea
                  value={draft.content}
                  onChange={(content) => patch({ content })}
                  aria-label={tProfile('articleContent')}
                  placeholder={t('contentPlaceholder')}
                  className="min-h-[50dvh] font-mono text-sm leading-relaxed"
                />
              ) : (
                <RichTextField
                  id="article-content"
                  aria-label={tProfile('articleContent')}
                  value={draft.content}
                  onChange={(content) => patch({ content })}
                  actions={ARTICLE_ACTIONS}
                  placeholder={t('contentPlaceholder')}
                  bare
                  handle={editorRef}
                  className="article-editor min-h-[50dvh] px-0 text-[1.0625rem] leading-[1.75]"
                />
              )}
              <p className="text-xs text-muted-foreground lg:hidden">
                {t('statsLine', { words: stats.words, chars: stats.chars, min: stats.minutes })}
              </p>
            </>
          )}
        </div>

        <aside className="sticky top-20 hidden lg:block">{settingsPanel}</aside>
      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('settings')}</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-2">{settingsPanel}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/**
 * Состояние сохранения: «Сохранение…», «Все изменения сохранены», «Не удалось сохранить»
 * с повтором; у опубликованной — «Есть неопубликованные правки». Объявляется читалкой.
 */
function SaveStatus({
  state,
  local,
  published,
  dirtyPublished,
  valid,
  empty,
  onRetry,
}: {
  state: AutosaveState
  local: ReturnType<typeof useLocalDraft>
  published: boolean
  dirtyPublished: boolean
  valid: boolean
  empty: boolean
  onRetry: () => void
}) {
  const t = useTranslations('Article')
  let text: string | null = null
  let tone = 'text-muted-foreground'
  if (published) text = dirtyPublished ? t('unpublishedChanges') : t('allPublished')
  else if (state === 'error') {
    text = t('saveFailed')
    tone = 'text-destructive'
  } else if (state === 'pending' || state === 'saving') text = t('saving')
  else if (state === 'saved') text = t('allSaved')
  else if (!valid && !empty && local === 'saved') text = t('savedOnDevice')
  if (!text) return null
  return (
    <span
      aria-live="polite"
      className={cn('flex min-w-0 items-center gap-1.5 truncate text-sm', tone)}
    >
      <span className="truncate">{text}</span>
      {state === 'error' && !published && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={t('retrySave')}
          title={t('retrySave')}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <RotateCw className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  )
}

/** Поле без рамок, растущее под текст. Enter в однострочных полях — переход к следующему. */
function AutoGrowTextarea({
  ref,
  value,
  onChange,
  onEnter,
  className,
  ...rest
}: Omit<React.ComponentProps<'textarea'>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
}) {
  const own = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = own.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      {...rest}
      ref={(node) => {
        own.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      rows={1}
      value={value}
      onChange={(e) => onChange(onEnter ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (onEnter && e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onEnter()
        }
      }}
      className={cn(
        'w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/50',
        className,
      )}
    />
  )
}

function EditorSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[45rem] flex-1 flex-col gap-6 py-16" aria-busy>
      <Skeleton className="h-12 w-4/5" />
      <Skeleton className="h-6 w-3/5" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}
