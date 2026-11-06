'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { STORY_HIGHLIGHT_TITLE_MAX } from '@studenthub/shared-schemas'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import {
  StoryThumb,
  addStoryHighlightItemRequest,
  createStoryHighlightRequest,
  fetchStoryHighlights,
  storyKeys,
  type StoryCard,
} from '../../../entities/story'
import { Button, Input, Label, Modal, Skeleton } from '../../../shared/ui'

/**
 * «Добавить в актуальное» из меню своей сторис: в одну из подборок или в новую. Сервер
 * копирует медиа к себе — сторис останется в профиле и после суток жизни.
 */
export function AddToHighlightModal({ story, onClose }: { story: StoryCard; onClose: () => void }) {
  const t = useTranslations('Stories')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id) ?? ''
  const [title, setTitle] = useState('')

  const highlights = useQuery({
    queryKey: storyKeys.highlights(myId),
    queryFn: () => fetchStoryHighlights(myId),
    enabled: !!myId,
  })

  // Повтор той же сторис и полная подборка — CONFLICT: говорим, что именно случилось.
  const fail = (e: unknown): void => {
    const code = toApiError(e).code
    toast.error(code === 'CONFLICT' ? t('highlightConflict') : tErr(code))
  }
  const done = (name: string): void => {
    // Подборки и их обложки — под общим ключом сторис.
    void qc.invalidateQueries({ queryKey: storyKeys.all })
    toast.success(t('highlightAdded', { title: name }))
    onClose()
  }

  const add = useMutation({
    mutationFn: (h: { id: string; title: string }) => addStoryHighlightItemRequest(h.id, story.id),
    onSuccess: (detail) => done(detail.title),
    onError: fail,
  })
  const create = useMutation({
    mutationFn: () => createStoryHighlightRequest(title.trim(), story.id),
    onSuccess: (detail) => done(detail.title),
    onError: fail,
  })
  const busy = add.isPending || create.isPending

  return (
    <Modal onClose={onClose} title={t('highlightPickTitle')} size="md">
      <div className="flex flex-col gap-5">
        {highlights.isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : highlights.isError ? (
          <p className="text-sm text-muted-foreground">{tErr('INTERNAL_ERROR')}</p>
        ) : (
          (highlights.data ?? []).length > 0 && (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {(highlights.data ?? []).map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => add.mutate(h)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-60"
                  >
                    <StoryThumb
                      media={h.cover?.media ?? null}
                      text={h.cover?.text ?? null}
                      background={h.cover?.background ?? null}
                      className="size-11 shrink-0 rounded-full"
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium break-words">
                      {h.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {h.itemsCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) create.mutate()
          }}
        >
          <Label htmlFor="highlight-title">{t('highlightNew')}</Label>
          <div className="flex gap-2">
            <Input
              id="highlight-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={STORY_HIGHLIGHT_TITLE_MAX}
              placeholder={t('highlightTitlePlaceholder')}
              className="min-w-0 flex-1"
            />
            <Button type="submit" loading={create.isPending} disabled={!title.trim() || busy}>
              <Plus className="size-4" aria-hidden />
              {t('highlightCreate')}
            </Button>
          </div>
        </form>

        <div className="flex justify-start">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
