'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Star, Trash2, X } from 'lucide-react'
import { STORY_HIGHLIGHT_TITLE_MAX } from '@studenthub/shared-schemas'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { useAppSelector } from '../../../shared/store'
import {
  StoryThumb,
  deleteStoryHighlightRequest,
  fetchStoryHighlight,
  fetchStoryHighlights,
  removeStoryHighlightItemRequest,
  reorderStoryHighlightItemsRequest,
  reorderStoryHighlightsRequest,
  storyKeys,
  updateStoryHighlightRequest,
} from '../../../entities/story'
import { Button, Input, Label, Modal, Skeleton, useConfirm } from '../../../shared/ui'

/** Переставить элемент списка на соседнее место; за краем — список как был. */
function moved<T>(list: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step
  if (target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target] as T, next[index] as T]
  return next
}

/**
 * Редактор подборки «Актуального»: название, место в ряду профиля, порядок сторис,
 * обложка, удаление сторис и всей подборки. Каждое действие уходит на сервер сразу —
 * кнопки «Сохранить» нет только у порядка и обложки, название сохраняется явно.
 */
export function EditHighlightModal({
  highlightId,
  onClose,
}: {
  highlightId: string
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id) ?? ''

  const detail = useQuery({
    queryKey: storyKeys.highlight(highlightId),
    queryFn: () => fetchStoryHighlight(highlightId),
  })
  const row = useQuery({
    queryKey: storyKeys.highlights(myId),
    queryFn: () => fetchStoryHighlights(myId),
    enabled: !!myId,
  })
  const [title, setTitle] = useState<string | null>(null)
  const shownTitle = title ?? detail.data?.title ?? ''

  const showError = (e: unknown): void => {
    toast.error(tErr(toApiError(e).code))
  }
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: storyKeys.all })
  }

  const rename = useMutation({
    mutationFn: () => updateStoryHighlightRequest(highlightId, { title: shownTitle.trim() }),
    onSuccess: () => {
      refresh()
      setTitle(null)
      toast.success(t('highlightSaved'))
    },
    onError: showError,
  })
  const setCover = useMutation({
    mutationFn: (itemId: string) =>
      updateStoryHighlightRequest(highlightId, { coverItemId: itemId }),
    onSuccess: () => {
      refresh()
      toast.success(t('highlightCoverSet'))
    },
    onError: showError,
  })
  const reorderItems = useMutation({
    mutationFn: (ids: string[]) => reorderStoryHighlightItemsRequest(highlightId, ids),
    onSuccess: refresh,
    onError: showError,
  })
  const move = useMutation({
    mutationFn: (ids: string[]) => reorderStoryHighlightsRequest(ids),
    onSuccess: refresh,
    onError: showError,
  })
  const removeItem = useMutation({
    mutationFn: (itemId: string) => removeStoryHighlightItemRequest(highlightId, itemId),
    onSuccess: ({ deleted }) => {
      refresh()
      toast.success(deleted ? t('highlightDeleted') : t('highlightItemRemoved'))
      if (deleted) onClose()
    },
    onError: showError,
  })
  const remove = useMutation({
    mutationFn: () => deleteStoryHighlightRequest(highlightId),
    onSuccess: () => {
      refresh()
      toast.success(t('highlightDeleted'))
      onClose()
    },
    onError: showError,
  })

  const data = detail.data
  const items = data?.items ?? []
  const highlightIds = (row.data ?? []).map((h) => h.id)
  const position = highlightIds.indexOf(highlightId)
  // Обложка — выбранная или, пока не выбрана, первая сторис подборки.
  const coverId = data?.coverItemId ?? items[0]?.id
  const busy = reorderItems.isPending || move.isPending || removeItem.isPending

  async function askRemoveItem(itemId: string): Promise<void> {
    if (await confirm({ title: t('highlightConfirmRemoveItem'), destructive: true })) {
      removeItem.mutate(itemId)
    }
  }
  async function askDelete(): Promise<void> {
    const ok = await confirm({
      title: t('highlightConfirmDelete', { title: data?.title ?? '' }),
      destructive: true,
    })
    if (ok) remove.mutate()
  }

  const arrow =
    'flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

  return (
    <Modal onClose={onClose} title={t('highlightEdit')} size="md">
      {detail.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : detail.isError || !data ? (
        <p className="text-sm text-muted-foreground">{tErr('INTERNAL_ERROR')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (shownTitle.trim() && shownTitle.trim() !== data.title) rename.mutate()
            }}
          >
            <Label htmlFor="highlight-edit-title">{t('highlightTitleLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="highlight-edit-title"
                value={shownTitle}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={STORY_HIGHLIGHT_TITLE_MAX}
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                loading={rename.isPending}
                disabled={!shownTitle.trim() || shownTitle.trim() === data.title}
              >
                {tCommon('save')}
              </Button>
            </div>
          </form>

          {highlightIds.length > 1 && position >= 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t('highlightPosition')}</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className={arrow}
                  disabled={busy || position === 0}
                  aria-label={t('moveEarlier')}
                  onClick={() => move.mutate(moved(highlightIds, position, -1))}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <span className="min-w-12 text-center text-sm tabular-nums">
                  {position + 1} / {highlightIds.length}
                </span>
                <button
                  type="button"
                  className={arrow}
                  disabled={busy || position === highlightIds.length - 1}
                  aria-label={t('moveLater')}
                  onClick={() => move.mutate(moved(highlightIds, position, 1))}
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('highlightOrder')}</span>
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              {items.map((item, index) => {
                const isCover = item.id === coverId
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-border p-1.5"
                  >
                    <StoryThumb
                      media={item.media}
                      text={item.text}
                      background={item.background}
                      className="h-14 w-8 shrink-0 rounded-md"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block text-muted-foreground">
                        {t('highlightStoryOf', { index: index + 1, total: items.length })}
                      </span>
                      {isCover && (
                        <span className="text-xs font-medium text-primary">
                          {t('highlightCoverBadge')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={cn(arrow, isCover && 'text-primary')}
                      disabled={busy || isCover || setCover.isPending}
                      aria-label={t('highlightMakeCover')}
                      title={t('highlightMakeCover')}
                      onClick={() => setCover.mutate(item.id)}
                    >
                      <Star className={cn('size-4', isCover && 'fill-current')} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={arrow}
                      disabled={busy || index === 0}
                      aria-label={t('moveEarlier')}
                      onClick={() => reorderItems.mutate(moved(items, index, -1).map((i) => i.id))}
                    >
                      <ChevronUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={arrow}
                      disabled={busy || index === items.length - 1}
                      aria-label={t('moveLater')}
                      onClick={() => reorderItems.mutate(moved(items, index, 1).map((i) => i.id))}
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={cn(arrow, 'hover:text-destructive')}
                      disabled={busy}
                      aria-label={t('highlightRemoveItem')}
                      title={t('highlightRemoveItem')}
                      onClick={() => void askRemoveItem(item.id)}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              loading={remove.isPending}
              onClick={() => void askDelete()}
            >
              <Trash2 className="size-4" aria-hidden />
              {t('highlightDelete')}
            </Button>
            <Button type="button" onClick={onClose}>
              {tCommon('close')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
