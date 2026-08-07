'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, ChevronUp, Clock, ImagePlus, Pencil, Save, Trash2 } from 'lucide-react'
import { ARTICLE_CATEGORIES, CONTENT_VISIBILITY } from '@studenthub/shared-schemas'
import { ARTICLE_TAGS } from '../../../shared/config'
import {
  createProfileArticle,
  profileContentKeys,
  updateProfileArticle,
  uploadArticleCover,
  type ProfileArticle,
} from '../../../entities/profile-content'
import {
  Button,
  Checkbox,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ContentModal } from './content-modal'
import { DictMultiSelect } from './dict-multi-select'
import { MarkdownToolbar } from './markdown-toolbar'
import { ArticleCover, ARTICLE_GRADIENTS } from './article-cover'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

type CoverMode = 'image' | 'gradient' | 'auto'

interface Props {
  userId: string
  initial?: ProfileArticle | null
  onClose: () => void
}

export function ArticleEditorModal({ userId, initial, onClose }: Props) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [coverMode, setCoverMode] = useState<CoverMode>(
    initial?.coverUrl ? 'image' : initial?.coverGradient ? 'gradient' : 'auto',
  )
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl ?? '')
  const [coverGradient, setCoverGradient] = useState(initial?.coverGradient ?? 'g1')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'ALL')
  const [allowComments, setAllowComments] = useState(initial?.allowComments ?? true)
  const [showSettings, setShowSettings] = useState(false)

  const coverMut = useMutation({
    mutationFn: uploadArticleCover,
    onSuccess: (r) => {
      setCoverUrl(r.url)
      setCoverMode('image')
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const saveMut = useMutation({
    mutationFn: (status: 'DRAFT' | 'PUBLISHED') => {
      const input = {
        title: title.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
        coverUrl: coverMode === 'image' ? coverUrl || undefined : undefined,
        coverGradient: coverMode === 'gradient' ? coverGradient : undefined,
        category: category ? (category as (typeof ARTICLE_CATEGORIES)[number]) : undefined,
        tags,
        visibility: visibility as (typeof CONTENT_VISIBILITY)[number],
        allowComments,
        status,
      }
      return initial ? updateProfileArticle(initial.id, input) : createProfileArticle(input)
    },
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileContentKeys.articles(userId) })
      toast.success(t('saved'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  const words = content.trim().split(/\s+/).filter(Boolean).length
  const readMin = Math.max(1, Math.ceil(words / 200))
  const canPublish = title.trim().length > 0 && content.trim().length > 0

  const coverTabs: { id: CoverMode; label: string }[] = [
    { id: 'image', label: t('coverImage') },
    { id: 'gradient', label: t('coverGradient') },
    { id: 'auto', label: t('coverAuto') },
  ]

  return (
    <ContentModal title={initial ? t('editArticle') : t('addArticle')} onClose={onClose} size="xl">
      <FormAlert error={apiError} />
      {/* Скрытый input загрузки обложки (используется областью загрузки и кнопкой замены) */}
      <input
        ref={coverRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) coverMut.mutate(f)
          e.target.value = ''
        }}
      />

      {/* Обложка: для «Изображение» — область загрузки / превью с правкой; иначе — превью */}
      {coverMode === 'image' ? (
        coverUrl ? (
          <div className="group relative">
            <ArticleCover
              coverUrl={coverUrl}
              title={title}
              className="h-[212px] w-full rounded-xl object-cover"
            />
            <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                aria-label={t('coverReplace')}
                onClick={() => coverRef.current?.click()}
                className="flex size-8 items-center justify-center rounded-lg bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('delete')}
                onClick={() => setCoverUrl('')}
                className="flex size-8 items-center justify-center rounded-lg bg-background/90 text-destructive shadow-sm backdrop-blur transition-colors hover:bg-background"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) coverMut.mutate(f)
            }}
            className="flex h-[212px] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <ImagePlus
              className={cn('size-6', coverMut.isPending && 'animate-pulse')}
              aria-hidden
            />
            <span className="text-sm font-medium">{t('coverUpload')}</span>
          </button>
        )
      ) : (
        <ArticleCover
          coverGradient={coverMode === 'gradient' ? coverGradient : null}
          title={title}
          className="h-[212px] rounded-xl"
        />
      )}

      {/* Режим обложки */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {coverTabs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCoverMode(c.id)}
              className={cn(
                'rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                coverMode === c.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {coverMode === 'gradient' && (
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">
            {ARTICLE_GRADIENTS.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-label={g.key}
                onClick={() => setCoverGradient(g.key)}
                className={cn(
                  'aspect-square w-full rounded-lg ring-2 ring-offset-2 ring-offset-card transition',
                  g.className,
                  coverGradient === g.key ? 'ring-primary' : 'ring-transparent',
                )}
              />
            ))}
          </div>
        )}
        {coverMode === 'auto' && (
          <p className="text-xs text-muted-foreground">{t('coverAutoHint')}</p>
        )}
      </div>

      {/* Заголовок */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="a-title">{t('articleTitle')}</Label>
        <Input
          id="a-title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('articleTitlePlaceholder')}
        />
      </div>

      {/* Краткое описание */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="a-desc">{t('articleDescription')}</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {description.length}/200
          </span>
        </div>
        <Input
          id="a-desc"
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('articleDescriptionPlaceholder')}
        />
      </div>

      {/* Категория + теги */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>{t('category')}</Label>
          <Select value={category || undefined} onValueChange={setCategory}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder={t('categoryPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {ARTICLE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`cat_${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="a-tags">{t('tags')}</Label>
          {/* Справочник тегов (2000+) с поиском; если тега нет — добавляется свой («другой»). */}
          <DictMultiSelect value={tags} onChange={setTags} options={ARTICLE_TAGS} max={15} />
        </div>
      </div>

      {/* Содержание */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="a-content">{t('articleContent')}</Label>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            {t('readingTime', { min: readMin })}
          </span>
        </div>
        <MarkdownToolbar textareaRef={contentRef} value={content} onChange={setContent} />
        <Textarea
          id="a-content"
          ref={contentRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={9}
          placeholder={t('articleContentPlaceholder')}
        />
      </div>

      {/* Настройки публикации (сворачиваемо) */}
      <div className="rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          {t('publishSettings')}
          {showSettings ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {showSettings && (
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <div className="flex flex-col gap-2">
              <Label>{t('visibility')}</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_VISIBILITY.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`vis_${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={allowComments}
                onCheckedChange={(v) => setAllowComments(v === true)}
              />
              {t('allowComments')}
            </label>
          </div>
        )}
      </div>

      {/* Действия */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          loading={saveMut.isPending && saveMut.variables === 'DRAFT'}
          disabled={!canPublish}
          onClick={() => saveMut.mutate('DRAFT')}
        >
          <Save className="size-4" aria-hidden />
          {t('saveDraft')}
        </Button>
        <Button
          type="button"
          loading={saveMut.isPending && saveMut.variables === 'PUBLISHED'}
          disabled={!canPublish}
          onClick={() => saveMut.mutate('PUBLISHED')}
        >
          <Check className="size-4" aria-hidden />
          {t('publish')}
        </Button>
      </div>
    </ContentModal>
  )
}
